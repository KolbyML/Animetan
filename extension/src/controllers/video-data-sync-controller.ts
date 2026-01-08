import {
    ActiveProfileMessage,
    ConfirmedVideoDataSubtitleTrack,
    OpenAsbplayerSettingsMessage,
    SerializedSubtitleFile,
    SettingsUpdatedMessage,
    VideoData,
    VideoDataSubtitleTrack,
    VideoDataUiBridgeConfirmMessage,
    VideoDataUiBridgeOpenFileMessage,
    VideoDataUiModel,
    VideoDataUiOpenReason,
    VideoDataSearchMessage,
    UpdateEpisodeMessage,
    OffsetToVideoMessage,
    VideoToExtensionCommand,
} from '@project/common';
import { AsbplayerSettings, SettingsProvider } from '@project/common/settings';
import { base64ToBlob, bufferToBase64 } from '@project/common/base64';
import Binding from '../services/binding';
import { currentPageDelegate } from '../services/pages';
import UiFrame from '../services/ui-frame';
import { fetchLocalization } from '../services/localization-fetcher';
import i18n from 'i18next';
import { ExtensionGlobalStateProvider } from '@/services/extension-global-state-provider';
import { isOnTutorialPage } from '@/services/tutorial';
import { fetchAnilistInfo } from '../services/anilist';
import { fetchSubtitles, parseEpisodeNumber } from '../services/subtitle';

declare global {
    function cloneInto(obj: any, targetScope: any, options?: any): any;
}

async function html(lang: string) {
    return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <title>asbplayer - Video Data Sync</title>
                <style>
                    @import url(${browser.runtime.getURL('/fonts/fonts.css')});
                </style>
            </head>
            <body>
                <div id="root" style="width:100%;height:100vh;"></div>
                <script type="application/json" id="loc">${JSON.stringify(await fetchLocalization(lang))}</script>
                <script type="module" src="${browser.runtime.getURL('/video-data-sync-ui.js')}"></script>
            </body>
            </html>`;
}

interface ShowOptions {
    reason: VideoDataUiOpenReason;
    fromAsbplayerId?: string;
}

interface ShowSettings {
    providerPattern?: string;
    offset?: number;
}

const fetchDataForLanguageOnDemand = (language: string): Promise<VideoData> => {
    return new Promise((resolve, reject) => {
        const listener = (event: Event) => {
            const data = (event as CustomEvent).detail as VideoData;
            resolve(data);
            document.removeEventListener('asbplayer-synced-language-data', listener, false);
        };
        document.addEventListener('asbplayer-synced-language-data', listener, false);
        document.dispatchEvent(new CustomEvent('asbplayer-get-synced-language-data', { detail: language }));
    });
};

const globalStateProvider = new ExtensionGlobalStateProvider();

export default class VideoDataSyncController {
    private readonly _context: Binding;
    private readonly _domain: string;
    private readonly _frame: UiFrame;
    private readonly _settings: SettingsProvider;

    private _autoSync?: boolean;
    private _lastLanguagesSynced: { [key: string]: string[] };
    private _emptySubtitle: VideoDataSubtitleTrack;
    private _syncedData?: VideoData;
    private _wasPaused?: boolean;
    private _fullscreenElement?: Element;
    private _activeElement?: Element;
    private _autoSyncAttempted: boolean = false;
    private _dataReceivedListener?: (event: Event) => void;
    private _isTutorial: boolean;
    private _episode: number | '' = '';
    private _isAnimeSite: boolean = false;
    private _pageLoadSynced: boolean = false;
    private _lastConfirmedTrackIds?: string[];
    private _currentAnimeTitle: string = '';
    private _messageListener?: (request: any, sender: any, sendResponse: any) => void;
    private _offsetEventListener?: (event: Event) => void;
    private _debugInfo: string = '';

    private _ignoreOffsetsUntil: number = 0;

    constructor(context: Binding, settings: SettingsProvider) {
        this._context = context;
        this._settings = settings;
        this._autoSync = false;
        this._lastLanguagesSynced = {};
        this._emptySubtitle = {
            id: '-',
            language: '-',
            url: '-',
            label: i18n.t('extension.videoDataSync.emptySubtitleTrack'),
            extension: 'srt',
        };
        this._domain = new URL(window.location.href).host;
        this._frame = new UiFrame(html);
        this._isTutorial = isOnTutorialPage();
        this._pageLoadSynced = false;
        this._isAnimeSite = false;

        this.init();

        this._messageListener = async (request, sender, sendResponse) => {
            if (request.sender === 'asbplayer-extension-to-video' && request.message.command === 'show-debug-info') {
                await this.showDebugInfo();
            }
        };
        browser.runtime.onMessage.addListener(this._messageListener);

        this._offsetEventListener = (event: Event) => {
            const customEvent = event as CustomEvent;
            const offset = customEvent.detail?.offset;

            if (Date.now() < this._ignoreOffsetsUntil) {
                this.appendDebug(`Ignored manual offset update: ${offset}ms (Lock Active)`);
                return;
            }

            if (this._currentAnimeTitle && typeof offset === 'number') {
                this._saveShowOffset(this._currentAnimeTitle, offset);
                this.appendDebug(`Saved Manual Offset: ${offset}ms for "${this._currentAnimeTitle}"`);
            }
        };
        this._context.video.addEventListener('asbplayer-offset-change', this._offsetEventListener);
    }

    private appendDebug(msg: string) {
        const time = new Date().toLocaleTimeString();
        this._debugInfo += `[${time}] ${msg}\n`;
        console.log('[ASBPlayer Sync Debug]', msg);
    }

    private async showDebugInfo() {
        const title = this._currentAnimeTitle || 'Unknown';
        const showSettings = await this._getShowSettings(title);

        let info = `Title: ${title}\n`;
        info += `Episode: ${this._episode}\n`;
        info += `Saved Provider Pattern: ${showSettings?.providerPattern ?? 'None'}\n`;
        info += `Saved Offset: ${showSettings?.offset ?? 0} ms\n`;
        info += `Is Anime Site: ${this._isAnimeSite}\n`;
        info += `Subtitles Loaded: ${this._hasSubtitles()}\n`;
        info += `Page Load Synced: ${this._pageLoadSynced}\n`;
        info += `Ignore Offsets Until: ${this._ignoreOffsetsUntil} (Now: ${Date.now()})\n`;

        this.appendDebug('User requested debug info.');
        this._debugInfo += '\n--- Current State ---\n' + info;

        await this.show({ reason: VideoDataUiOpenReason.userRequested });
    }

    private async init() {
        await this.checkIfAnimeSite();

        if (this._isAnimeSite && !this._hasSubtitles()) {
            this.appendDebug('Init: Anime site detected, no subtitles loaded.');
            try {
                const { title, episode } = await this.obtainTitleAndEpisode();
                if (title && episode) {
                    this._currentAnimeTitle = title;
                    this.appendDebug(`Init: Obtained info - Title: "${title}", Ep: ${episode}`);
                    await this._attemptSilentAutoSync(title, parseInt(episode));
                } else {
                    this.appendDebug('Init: Failed to obtain Title/Episode.');
                }
            } catch (e) {
                this.appendDebug(`Init Error: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    }

    private async _attemptSilentAutoSync(title: string, episode: number) {
        const apiKey = await this._context.settings.getSingle('apiKey');
        const showSettings = await this._getShowSettings(title);

        this.appendDebug(`AutoSync: Saved Provider for "${title}": "${showSettings?.providerPattern ?? 'NONE'}"`);

        try {
            const { anilistId } = await fetchAnilistInfo(title);
            if (!anilistId) throw new Error('Anilist ID not found');

            const subtitles = await fetchSubtitles(anilistId, episode, apiKey || '');
            if (typeof subtitles === 'string') throw new Error(subtitles);

            const fetchedSubtitles: VideoDataSubtitleTrack[] = subtitles.map((sub, index) => {
                const url = new URL(sub.url);
                const extension = url.pathname.split('.').pop() || 'srt';
                return {
                    id: `fetched-${index}`,
                    language: 'ja',
                    url: sub.url,
                    label: sub.name,
                    extension: extension,
                };
            });

            this.appendDebug(`AutoSync: Fetched ${fetchedSubtitles.length} tracks.`);
            
            this._syncedData = {
                subtitles: fetchedSubtitles,
                basename: title,
                error: undefined,
            } as VideoData;
            this._episode = episode;

            let matchedTrack: VideoDataSubtitleTrack | undefined;
            if (showSettings?.providerPattern) {
                const pattern = showSettings.providerPattern;
                const regex = new RegExp(pattern);
                
                matchedTrack = fetchedSubtitles.find((t) => regex.test(t.label));

                this.appendDebug(
                    `AutoSync: Match attempt with "${pattern}" -> ${matchedTrack ? 'FOUND' : 'NOT FOUND'}`
                );
            } else {
                this.appendDebug('AutoSync: No provider pattern set.');
            }

            if (matchedTrack) {
                this._pageLoadSynced = true;
                const selection = [matchedTrack, this._emptySubtitle, this._emptySubtitle];
                await this._syncData(selection);
                this.appendDebug('AutoSync: Loaded track silently.');
            } else {
                await this.show({
                    reason: showSettings?.providerPattern
                        ? VideoDataUiOpenReason.failedToAutoLoadPreferredTrack
                        : VideoDataUiOpenReason.userRequested,
                });
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.appendDebug(`AutoSync Failed: ${msg}`);
            await this.show({ reason: VideoDataUiOpenReason.userRequested });
        }
    }

    private get lastLanguagesSynced(): string[] {
        return this._lastLanguagesSynced[this._domain] ?? [];
    }

    private set lastLanguagesSynced(value: string[]) {
        this._lastLanguagesSynced[this._domain] = value;
    }

    unbind() {
        if (this._dataReceivedListener) {
            document.removeEventListener('asbplayer-synced-data', this._dataReceivedListener, false);
        }

        if (this._messageListener) {
            browser.runtime.onMessage.removeListener(this._messageListener);
            this._messageListener = undefined;
        }

        if (this._offsetEventListener) {
            this._context.video.removeEventListener('asbplayer-offset-change', this._offsetEventListener);
            this._offsetEventListener = undefined;
        }

        this._frame.unbind();
        this._dataReceivedListener = undefined;
        this._syncedData = undefined;
    }

    updateSettings({ streamingAutoSync, streamingLastLanguagesSynced }: AsbplayerSettings) {
        this._autoSync = streamingAutoSync;
        this._lastLanguagesSynced = streamingLastLanguagesSynced;

        if (this._frame.clientIfLoaded !== undefined) {
            this._context.settings.getSingle('themeType').then((themeType) => {
                const profilesPromise = this._context.settings.profiles();
                const activeProfilePromise = this._context.settings.activeProfile();
                Promise.all([profilesPromise, activeProfilePromise]).then(([profiles, activeProfile]) => {
                    this._frame.clientIfLoaded?.updateState({
                        settings: {
                            themeType,
                            profiles,
                            activeProfile: activeProfile?.name,
                        },
                    });
                });
            });
        }
    }

    async requestSubtitles() {
        const hasPageScript = this._context.hasPageScript;
        const pageDelegate = await currentPageDelegate();
        const isVideoPage = pageDelegate?.isVideoPage();
        if ((!hasPageScript || !isVideoPage) && !this._isAnimeSite) {
            return;
        }

        if (!this._hasSubtitles()) {
            this._syncedData = undefined;
            this._autoSyncAttempted = false;
        }

        if (!this._dataReceivedListener) {
            this._dataReceivedListener = (event: Event) => {
                const data = (event as CustomEvent).detail as VideoData;
                if (data?.reAttempt) {
                    this._autoSyncAttempted = false;
                }
                this._setSyncedData(data);
            };
            document.addEventListener('asbplayer-synced-data', this._dataReceivedListener, false);
        }

        if (pageDelegate?.config.key === 'youtube') {
            const targetTranslationLanguageCodes =
                (await this._settings.getSingle('streamingPages')).youtube.targetLanguages ?? [];
            let payload = { targetTranslationLanguageCodes };
            if (typeof cloneInto === 'function') {
                payload = cloneInto(payload, document.defaultView);
            }
            document.dispatchEvent(new CustomEvent('asbplayer-get-synced-data', { detail: payload }));
        } else {
            if (this._hasSubtitles()) {
                if (this._isAnimeSite && this._pageLoadSynced) {
                    return;
                }
                this.show({ reason: VideoDataUiOpenReason.userRequested });
            } else {
                document.dispatchEvent(new CustomEvent('asbplayer-get-synced-data'));
            }
        }
    }

    async show({ reason, fromAsbplayerId }: ShowOptions) {
        const client = await this._client();
        const additionalFields: Partial<VideoDataUiModel> = {
            open: true,
            openReason: reason,
        };

        if (fromAsbplayerId !== undefined) {
            additionalFields.openedFromAsbplayerId = fromAsbplayerId;
        }

        const model = await this._buildModel(additionalFields);
        this._prepareShow();
        client.updateState(model);
    }

    private async _buildModel(additionalFields: Partial<VideoDataUiModel>) {
        const subtitleTrackChoices = this._syncedData?.subtitles ?? [];
        const subs = await this._matchLastSyncedWithAvailableTracks();
        const autoSelectedTracks: VideoDataSubtitleTrack[] = subs.autoSelectedTracks;
        const autoSelectedTrackIds = this._isTutorial
            ? ['1', '-', '-']
            : autoSelectedTracks.map((subtitle) => subtitle.id || '-');
        const defaultCheckboxState = !this._isTutorial && subs.completeMatch;
        const themeType = await this._context.settings.getSingle('themeType');
        const profilesPromise = this._context.settings.profiles();
        const activeProfilePromise = this._context.settings.activeProfile();
        const hasSeenFtue = (await globalStateProvider.get(['ftueHasSeenSubtitleTrackSelector']))
            .ftueHasSeenSubtitleTrackSelector;
        const hideRememberTrackPreferenceToggle = this._isTutorial || (await this._pageHidesTrackPrefToggle());
        await this.checkIfAnimeSite();
        let title = '';
        let episode = '';
        let autoSelectBasedOnLastSavedSub = autoSelectedTrackIds;

        if (this._isAnimeSite) {
            ({ title, episode } = await this.obtainTitleAndEpisode());
            this._currentAnimeTitle = title;
            if (subs.completeMatch && subtitleTrackChoices.length > 0) {
                autoSelectBasedOnLastSavedSub = autoSelectedTrackIds;
            } else {
                autoSelectBasedOnLastSavedSub =
                    this._lastConfirmedTrackIds ??
                    (subtitleTrackChoices.length > 0 ? [subtitleTrackChoices[0].id, '-', '-'] : autoSelectedTrackIds);
            }
        }

        const model: any = this._syncedData
            ? {
                  isLoading: this._syncedData.subtitles === undefined,
                  suggestedName: title ? title : this._syncedData.basename,
                  selectedSubtitle: autoSelectBasedOnLastSavedSub,
                  subtitles: subtitleTrackChoices,
                  error: this._syncedData.error,
                  defaultCheckboxState: defaultCheckboxState,
                  openedFromAsbplayerId: '',
                  settings: {
                      themeType,
                      profiles: await profilesPromise,
                      activeProfile: (await activeProfilePromise)?.name,
                      apiKey: await this._context.settings.getSingle('apiKey'),
                  },
                  hasSeenFtue,
                  hideRememberTrackPreferenceToggle,
                  episode: episode ? episode : this._episode,
                  isAnimeSite: this._isAnimeSite,
                  ...additionalFields,
              }
            : {
                  isLoading: this._context.hasPageScript,
                  suggestedName: title ? title : document.title,
                  selectedSubtitle: autoSelectedTrackIds,
                  error: '',
                  showSubSelect: true,
                  subtitles: subtitleTrackChoices,
                  defaultCheckboxState: defaultCheckboxState,
                  openedFromAsbplayerId: '',
                  settings: {
                      themeType,
                      profiles: await profilesPromise,
                      activeProfile: (await activeProfilePromise)?.name,
                  },
                  hasSeenFtue,
                  hideRememberTrackPreferenceToggle,
                  episode: this._episode,
                  isAnimeSite: this._isAnimeSite,
                  ...additionalFields,
              };

        model.debugInfo = this._debugInfo;
        return model;
    }

    private async _matchLastSyncedWithAvailableTracks() {
        const subtitleTrackChoices = this._syncedData?.subtitles ?? [];
        let tracks = {
            autoSelectedTracks: [this._emptySubtitle, this._emptySubtitle, this._emptySubtitle],
            completeMatch: false,
        };

        if (this._isAnimeSite && this._currentAnimeTitle) {
            const settings = await this._getShowSettings(this._currentAnimeTitle);
            if (settings?.providerPattern) {
                try {
                    const regex = new RegExp(settings.providerPattern);
                    const preferredTrack = subtitleTrackChoices.find((t) => regex.test(t.label));
                    if (preferredTrack) {
                        tracks.autoSelectedTracks[0] = preferredTrack;
                        tracks.completeMatch = true;
                        return tracks;
                    }
                } catch (e) {
                    console.error("Invalid saved provider regex", e);
                }
            }
        }

        const emptyChoice = this.lastLanguagesSynced.some((lang) => lang !== '-') === undefined;

        if (!subtitleTrackChoices.length && emptyChoice) {
            tracks.completeMatch = true;
        } else {
            let matches: number = 0;
            for (let i = 0; i < this.lastLanguagesSynced.length; i++) {
                const language = this.lastLanguagesSynced[i];
                for (let j = 0; j < subtitleTrackChoices.length; j++) {
                    if (language === '-') {
                        matches++;
                        break;
                    } else if (language === subtitleTrackChoices[j].language) {
                        tracks.autoSelectedTracks[i] = subtitleTrackChoices[j];
                        matches++;
                        break;
                    }
                }
            }
            if (matches === this.lastLanguagesSynced.length) {
                tracks.completeMatch = true;
            }
        }

        return tracks;
    }

    private _defaultVideoName(basename: string | undefined, subtitleTrack: VideoDataSubtitleTrack) {
        if (subtitleTrack.url === '-') {
            return basename ?? '';
        }

        if (basename) {
            return `${basename} - ${subtitleTrack.label}`;
        }

        return subtitleTrack.label;
    }

    private async _setSyncedData(data: VideoData) {
        this._syncedData = data;

        if (data.basename && this._isAnimeSite) {
            this._currentAnimeTitle = data.basename;
        }

        if (this._syncedData?.subtitles !== undefined && (await this._canAutoSync())) {
            if (!this._autoSyncAttempted) {
                this._autoSyncAttempted = true;
                const subs = await this._matchLastSyncedWithAvailableTracks();
                const isAnimeSite = this._isAnimeSite;
                const hasAvailableSubtitles = this._syncedData.subtitles.length > 0;

                const shouldAutoSync = isAnimeSite ? hasAvailableSubtitles && subs.completeMatch : subs.completeMatch;

                if (shouldAutoSync) {
                    let autoSelectedTracks: VideoDataSubtitleTrack[] = subs.autoSelectedTracks;
                    await this._syncData(autoSelectedTracks);

                    if (!this._frame.hidden) {
                        this._hideAndResume();
                    }
                } else if (isAnimeSite && hasAvailableSubtitles) {
                    await this._attemptSilentAutoSync(this._currentAnimeTitle, parseInt(String(this._episode)));
                } else {
                    const shouldPrompt = await this._settings.getSingle('streamingAutoSyncPromptOnFailure');
                    if (shouldPrompt) {
                        await this.show({ reason: VideoDataUiOpenReason.failedToAutoLoadPreferredTrack });
                    }
                }
            }
        } else if (this._frame.clientIfLoaded !== undefined) {
            const subtitleTrackChoices = this._syncedData?.subtitles ?? [];
            this._frame.clientIfLoaded.updateState({
                subtitles: subtitleTrackChoices,
                isLoading: false,
            });
        }
    }

    private _hasSubtitles(): boolean {
        return (this._syncedData?.subtitles?.length || 0) > 0;
    }

    private async _canAutoSync(): Promise<boolean> {
        const page = await currentPageDelegate();
        if (page === undefined) {
            return this._autoSync ?? false;
        }
        return this._autoSync === true && page.canAutoSync(this._context.video);
    }

    private async _pageHidesTrackPrefToggle() {
        return (await currentPageDelegate())?.config?.hideRememberTrackPreferenceToggle ?? false;
    }

    /**
     * Helper to append a wildcard .*? between the episode number and a known release tag.
     */
    private _addWildcardForVariableTitles(pattern: string): string {
        const anchor = '\\d+';
        const anchorIndex = pattern.indexOf(anchor);
        
        if (anchorIndex === -1) return `^${pattern}$`;

        const tags = ['WEBRip', 'WEB-DL', 'BluRay', '1080p', '720p', 'x264', 'AAC', 'Amazon', 'Netflix', 'Hi10p'];
        const afterAnchor = pattern.substring(anchorIndex + anchor.length);
        
        let bestTagIndex = -1;
        
        for (const tag of tags) {
            // Match escaped delimiters (\. or \[) followed by the tag
            const tagRegex = new RegExp(`(\\\\\\\.|\\s|\\\\\\\[)${tag}`, 'i');
            const m = afterAnchor.match(tagRegex);
            if (m && m.index !== undefined) {
                if (bestTagIndex === -1 || m.index < bestTagIndex) {
                    bestTagIndex = m.index;
                }
            }
        }
        
        if (bestTagIndex !== -1) {
             const prefix = pattern.substring(0, anchorIndex + anchor.length);
             const suffix = afterAnchor.substring(bestTagIndex); 
             return `^${prefix}.*?${suffix}$`;
        }
        
        return `^${pattern}$`;
    }

    /**
     * Generates a Regex pattern from a filename that identifies the "Provider" 
     * while genericizing the episode number.
     */
    private _extractProviderPattern(filename: string): string {
        const epNum = parseEpisodeNumber(filename);
        let currentPattern = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        if (epNum === null) return `^${currentPattern}$`;

        let replaced = false;

        // 1. Japanese Format (e.g. 第208話 -> 第\d+話)
        const jpMatches = [...filename.matchAll(/第(\d+)話/g)];
        for (const match of jpMatches) {
             const fullMatchStr = match[0];
             const escapedMatchStr = fullMatchStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
             const genericMatchStr = escapedMatchStr.replace(/\d+/, '\\d+');
             
             if (currentPattern.includes(escapedMatchStr)) {
                 currentPattern = currentPattern.replace(escapedMatchStr, genericMatchStr);
                 replaced = true;
             }
        }

        // 2. Standard SxxExx (e.g. S02E078 -> S\d+E\d+)
        const sxxMatches = [...filename.matchAll(/S\d+E(\d+)/ig)];
        for (const match of sxxMatches) {
             const fullMatchStr = match[0];
             const escapedMatchStr = fullMatchStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
             const genericMatchStr = escapedMatchStr.replace(/\d+/g, '\\d+');
             
             if (currentPattern.includes(escapedMatchStr)) {
                 currentPattern = currentPattern.replace(escapedMatchStr, genericMatchStr);
                 replaced = true;
             }
        }
        
        // 3. Loose Matches (e.g. [07] or - 07) using index-based context
        const looseMatches = [...filename.matchAll(/(?:^|[\s_\-\.\[])(\d{1,4})(?:v\d)?(?:[\s_\-\.\]]|$)/g)];
        for (const match of looseMatches) {
            const val = parseInt(match[1], 10);
            if (val === 720 || val === 1080 || val === 2160 || val === 264 || val === 265) continue;

            if (val === epNum) {
                 const numberStr = match[1];
                 const fullContext = match[0];
                 const escapedContext = fullContext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                 const genericContext = escapedContext.replace(numberStr, '\\d+');
                 
                 if (currentPattern.includes(escapedContext)) {
                     currentPattern = currentPattern.replace(escapedContext, genericContext);
                     replaced = true;
                 }
            }
        }

        if (replaced) {
            return this._addWildcardForVariableTitles(currentPattern);
        }

        return `^${currentPattern}$`;
    }

    private async _client() {
        this._frame.language = await this._settings.getSingle('language');
        const isNewClient = await this._frame.bind();
        const client = await this._frame.client();

        if (isNewClient) {
            client.onMessage(async (message) => {
                if ('openSettings' === message.command) {
                    const openSettingsCommand: VideoToExtensionCommand<OpenAsbplayerSettingsMessage> = {
                        sender: 'asbplayer-video',
                        message: {
                            command: 'open-asbplayer-settings',
                        },
                        src: this._context.video.src,
                    };
                    browser.runtime.sendMessage(openSettingsCommand);
                    return;
                }

                if ('activeProfile' === message.command) {
                    const activeProfileMessage = message as ActiveProfileMessage;
                    await this._context.settings.setActiveProfile(activeProfileMessage.profile);
                    browser.runtime.sendMessage({
                        sender: 'asbplayer-video',
                        message: { command: 'settings-updated' },
                        src: this._context.video.src,
                    });
                    return;
                }

                if ('dismissFtue' === message.command) {
                    globalStateProvider.set({ ftueHasSeenSubtitleTrackSelector: true }).catch(console.error);
                    return;
                }

                if (message.command === 'updateApiKey') {
                    const msgAny = message as any;
                    if (msgAny.apiKey !== undefined) {
                        await this._context.settings.set({ apiKey: msgAny.apiKey });
                        this.appendDebug(`Updated API Key`);
                    }
                    return;
                }

                let dataWasSynced = true;

                if ('confirm' === message.command) {
                    const confirmMessage = message as VideoDataUiBridgeConfirmMessage;
                    this._lastConfirmedTrackIds = confirmMessage.data.map((track) => track.id || '-');

                    if (confirmMessage.shouldRememberTrackChoices) {
                        this.lastLanguagesSynced = confirmMessage.data
                            .map((track) => track.language)
                            .filter((language) => language !== undefined) as string[];
                        await this._context.settings
                            .set({ streamingLastLanguagesSynced: this._lastLanguagesSynced })
                            .catch(() => {});
                    }

                    const data = confirmMessage.data as ConfirmedVideoDataSubtitleTrack[];

                    if (this._isAnimeSite && this._currentAnimeTitle && data.length > 0) {
                        const track = data.find((t) => t.id !== '-');
                        if (track) {
                            const provider = this._extractProviderPattern(track.label);
                            if (provider) {
                                this.appendDebug(
                                    `Manual Confirm: Saving provider "${provider}" for title "${this._currentAnimeTitle}"`
                                );
                                await this._saveShowProvider(this._currentAnimeTitle, provider);
                            }
                        }
                    }

                    dataWasSynced = await this._syncDataArray(data, confirmMessage.syncWithAsbplayerId);
                } else if ('openFile' === message.command) {
                    const openFileMessage = message as VideoDataUiBridgeOpenFileMessage;
                    const subtitles = openFileMessage.subtitles as SerializedSubtitleFile[];
                    try {
                        await this._syncSubtitles(subtitles, false);
                        dataWasSynced = true;
                    } catch (e) {
                        if (e instanceof Error) {
                            await this._reportError(e.message);
                        }
                    }
                } else if ('updateEpisode' === message.command) {
                    const updateEpisodeMessage = message as UpdateEpisodeMessage;
                    this._episode = updateEpisodeMessage.episode;
                    client.updateState({ episode: this._episode, open: true });
                    dataWasSynced = false;
                } else if ('search' === message.command) {
                    const searchSubtitlesMessage = message as VideoDataSearchMessage;
                    await this._handleSearch(searchSubtitlesMessage);
                    dataWasSynced = false;
                }

                if (dataWasSynced) {
                    this._hideAndResume();
                }
            });
        }

        this._frame.show();
        return client;
    }

    private async _prepareShow() {
        const client = await this._client();
        await this.checkIfAnimeSite();
        const { title, episode } = await this.obtainTitleAndEpisode();
        this._currentAnimeTitle = title;

        client.updateState({
            isAnimeSite: this._isAnimeSite,
            suggestedName: title || this._syncedData?.basename || document.title,
            episode: episode ? parseInt(episode) : '',
            open: true,
        });

        this._wasPaused = this._wasPaused ?? this._context.video.paused;
        this._context.pause();

        if (document.fullscreenElement) {
            this._fullscreenElement = document.fullscreenElement;
            document.exitFullscreen();
        }

        if (document.activeElement) {
            this._activeElement = document.activeElement;
        }

        this._context.keyBindings.unbind();
        this._context.subtitleController.forceHideSubtitles = true;
        this._context.mobileVideoOverlayController.forceHide = true;
    }

    private _hideAndResume() {
        this._context.keyBindings.bind(this._context);
        this._context.subtitleController.forceHideSubtitles = false;
        this._context.mobileVideoOverlayController.forceHide = false;
        this._frame?.hide();

        if (this._fullscreenElement) {
            this._fullscreenElement.requestFullscreen();
            this._fullscreenElement = undefined;
        }

        if (this._activeElement) {
            if (typeof (this._activeElement as HTMLElement).focus === 'function') {
                (this._activeElement as HTMLElement).focus();
            }
            this._activeElement = undefined;
        } else {
            window.focus();
        }

        if (!this._wasPaused) {
            this._context.play();
        }

        this._wasPaused = undefined;
    }

    private async _syncData(data: VideoDataSubtitleTrack[]) {
        try {
            let subtitles: SerializedSubtitleFile[] = [];
            for (let i = 0; i < data.length; i++) {
                const { extension, url, language, localFile } = data[i];
                const subtitleFiles = await this._subtitlesForUrl(
                    this._defaultVideoName(this._syncedData?.basename, data[i]),
                    language,
                    extension,
                    url,
                    localFile
                );
                if (subtitleFiles !== undefined) {
                    subtitles.push(...subtitleFiles);
                }
            }
            await this._syncSubtitles(
                subtitles,
                data.some((track) => typeof track.url === 'object')
            );
            return true;
        } catch (error) {
            if (typeof (error as Error).message !== 'undefined') {
                await this._reportError(`Data Sync failed: ${(error as Error).message}`);
            }
            return false;
        }
    }

    private async _syncDataArray(data: ConfirmedVideoDataSubtitleTrack[], syncWithAsbplayerId?: string) {
        try {
            let subtitles: SerializedSubtitleFile[] = [];
            for (let i = 0; i < data.length; i++) {
                const { name, language, extension, url, localFile } = data[i];
                const subtitleFiles = await this._subtitlesForUrl(name, language, extension, url, localFile);
                if (subtitleFiles !== undefined) {
                    subtitles.push(...subtitleFiles);
                }
            }
            await this._syncSubtitles(
                subtitles,
                data.some((track) => typeof track.url === 'object'),
                syncWithAsbplayerId
            );
            return true;
        } catch (error) {
            if (typeof (error as Error).message !== 'undefined') {
                await this._reportError(`Data Sync failed: ${(error as Error).message}`);
            }
            return false;
        }
    }

    private async _syncSubtitles(
        serializedFiles: SerializedSubtitleFile[],
        flatten: boolean,
        syncWithAsbplayerId?: string
    ) {
        const files: File[] = await Promise.all(
            serializedFiles.map(async (f) => new File([base64ToBlob(f.base64, 'text/plain')], f.name))
        );

        let offsetToApply = 0;

        if (this._isAnimeSite && this._currentAnimeTitle) {
            this._ignoreOffsetsUntil = Date.now() + 4000;

            const settings = await this._getShowSettings(this._currentAnimeTitle);
            offsetToApply = settings?.offset ?? 0;
            this.appendDebug(`Applying offset: ${offsetToApply}ms for "${this._currentAnimeTitle}" (Lock Active)`);

            await this._context.settings.set({ lastSubtitleOffset: offsetToApply });
        }

        this._context.loadSubtitles(files, flatten, syncWithAsbplayerId);

        if (this._isAnimeSite && this._currentAnimeTitle) {
            const offsetCommand: OffsetToVideoMessage = {
                command: 'offset',
                value: offsetToApply,
                echo: false,
            };

            const extensionCommand: VideoToExtensionCommand<OffsetToVideoMessage> = {
                sender: 'asbplayer-video',
                message: offsetCommand,
                src: this._context.video.src,
            };

            setTimeout(() => {
                chrome.runtime.sendMessage(extensionCommand);
            }, 500);
            setTimeout(() => {
                chrome.runtime.sendMessage(extensionCommand);
            }, 1500);
            setTimeout(() => {
                chrome.runtime.sendMessage(extensionCommand);
                this.appendDebug('Offset lock period ended.');
            }, 4000);
        }
    }

    private async _subtitlesForUrl(
        name: string,
        language: string | undefined,
        extension: string,
        url: string | string[],
        localFile: boolean | undefined
    ): Promise<SerializedSubtitleFile[] | undefined> {
        if (url === '-') {
            return [
                {
                    name: `${name}.${extension}`,
                    base64: '',
                },
            ];
        }

        if (url === 'lazy') {
            if (language === undefined) {
                await this._reportError('Unable to determine language');
                return undefined;
            }
            const data = await fetchDataForLanguageOnDemand(language);
            if (data.error) {
                await this._reportError(data.error);
                return undefined;
            }
            const lazilyFetchedUrl = data.subtitles?.find((t) => t.language === language)?.url;
            if (lazilyFetchedUrl === undefined) {
                await this._reportError('Failed to fetch subtitles for specified language');
                return undefined;
            }
            url = lazilyFetchedUrl;
        }

        if (typeof url === 'string') {
            const response = await fetch(url)
                .catch((error) => this._reportError(error.message))
                .finally(() => {
                    if (localFile) {
                        URL.revokeObjectURL(url);
                    }
                });

            if (!response) {
                return undefined;
            }
            if (!response.ok) {
                throw new Error(`Subtitle Retrieval failed with Status ${response.status}/${response.statusText}...`);
            }
            return [
                {
                    name: `${name}.${extension}`,
                    base64: response ? bufferToBase64(await response.arrayBuffer()) : '',
                },
            ];
        }

        const firstUri = url[0];
        const partExtension = firstUri.substring(firstUri.lastIndexOf('.') + 1);
        const fileName = `${name}.${partExtension}`;
        const promises = url.map((u) => fetch(u));
        const tracks = [];
        let totalPromises = promises.length;
        let finishedPromises = 0;

        for (const p of promises) {
            const response = await p;
            if (!response.ok) {
                throw new Error(`Subtitle Retrieval failed with Status ${response.status}/${response.statusText}...`);
            }
            ++finishedPromises;
            this._context.subtitleController.notification(
                `${fileName} (${Math.floor((finishedPromises / totalPromises) * 100)}%)`
            );
            tracks.push({
                name: fileName,
                base64: bufferToBase64(await response.arrayBuffer()),
            });
        }
        return tracks;
    }

    private async _reportError(error: string) {
        const client = await this._client();
        const themeType = await this._context.settings.getSingle('themeType');
        this._prepareShow();
        return client.updateState({
            open: true,
            isLoading: false,
            showSubSelect: true,
            error,
            themeType: themeType,
        });
    }

    private async _handleSearch(message: VideoDataSearchMessage) {
        const client = await this._client();
        client.updateState({ isLoading: true, error: null, open: true });

        const apiKey = await this._context.settings.getSingle('apiKey');

        try {
            const { anilistId } = await fetchAnilistInfo(message.title);
            if (!anilistId) {
                throw new Error('Unable to find Anilist ID for the given title');
            }

            const subtitles = await fetchSubtitles(anilistId, message.episode || 0, apiKey || '');
            if (typeof subtitles === 'string') {
                throw new Error(subtitles);
            }

            const fetchedSubtitles = subtitles
                .map((sub, index) => {
                    const url = new URL(sub.url);
                    const extension = url.pathname.split('.').pop() || 'srt';
                    return {
                        id: `fetched-${index}`,
                        language: 'ja',
                        url: sub.url,
                        label: sub.name,
                        extension: extension,
                    };
                })
                .filter((sub) => sub.url && sub.label);

            const { title } = await this.obtainTitleAndEpisode();
            this._currentAnimeTitle = title;

            this._syncedData = {
                ...this._syncedData,
                subtitles: fetchedSubtitles,
                basename: title,
            } as VideoData;

            if (fetchedSubtitles.length > 0 && this._autoSync && !this._pageLoadSynced) {
                const match = await this._matchLastSyncedWithAvailableTracks();

                if (match.completeMatch) {
                    this._pageLoadSynced = true;
                    await this._syncData(match.autoSelectedTracks);
                    client.updateState({ open: false });
                    this._hideAndResume();
                    return;
                }
            }

            client.updateState({
                subtitles: fetchedSubtitles,
                isLoading: false,
                episode: message.episode,
                open: true,
                suggestedName: title,
                selectedSubtitle: fetchedSubtitles.length > 0 ? [`fetched-0`, '-', '-'] : ['-', '-', '-'],
            });
        } catch (error) {
            client.updateState({
                error: error instanceof Error ? error.message : 'An error occurred while fetching subtitles',
                episode: message.episode || '',
                subtitles: [],
                isLoading: false,
                open: true,
            });
        }
    }

    private async checkIfAnimeSite(): Promise<void> {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ command: 'check-if-anime-site' }, (response) => {
                this._isAnimeSite = response.isAnimeSite;
                resolve();
            });
        });
    }

    private async obtainTitleAndEpisode(): Promise<{ title: string; episode: string }> {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ command: 'get-anime-title-and-episode' }, (response) => {
                if (response.error) {
                    reject({ title: '', episode: '' });
                } else {
                    resolve({ title: response.title, episode: response.episode?.toString() });
                }
            });
        });
    }

    // --- Storage Helpers ---

    private async _getShowSettings(title: string): Promise<ShowSettings | undefined> {
        const key = `show_settings_${title}`;
        const data = await browser.storage.local.get(key);
        return data[key];
    }

    private async _saveShowProvider(title: string, providerPattern: string) {
        const key = `show_settings_${title}`;
        const current = (await this._getShowSettings(title)) || {};
        current.providerPattern = providerPattern;
        await browser.storage.local.set({ [key]: current });
    }

    private async _saveShowOffset(title: string, offset: number) {
        const key = `show_settings_${title}`;
        const current = (await this._getShowSettings(title)) || {};
        current.offset = offset;
        await browser.storage.local.set({ [key]: current });
    }
}