import {
    AutoPauseContext,
    CopyToClipboardMessage,
    OffsetFromVideoMessage,
    OffsetToVideoMessage, // Added import
    SubtitleModel,
    SubtitleHtml,
    VideoToExtensionCommand,
} from '@project/common';
import {
    SettingsProvider,
    SubtitleAlignment,
    SubtitleSettings,
    TextSubtitleSettings,
    allTextSubtitleSettings,
} from '@project/common/settings';
import { SubtitleCollection, SubtitleSlice } from '@project/common/subtitle-collection';
import { computeStyleString, surroundingSubtitles } from '@project/common/util';
import i18n from 'i18next';
import {
    CachingElementOverlay,
    ElementOverlay,
    ElementOverlayParams,
    KeyedHtml,
    OffsetAnchor,
} from '../services/element-overlay';

const boundingBoxPadding = 25;

const _intersects = (clientX: number, clientY: number, element: HTMLElement): boolean => {
    const rect = element.getBoundingClientRect();
    return (
        clientX >= rect.x - boundingBoxPadding &&
        clientX <= rect.x + rect.width + boundingBoxPadding &&
        clientY >= rect.y - boundingBoxPadding &&
        clientY <= rect.y + rect.height + boundingBoxPadding
    );
};

export interface SubtitleModelWithIndex extends SubtitleModel {
    index: number;
}

export default class SubtitleController {
    private readonly video: HTMLMediaElement;
    private readonly settings: SettingsProvider;

    private showingSubtitles?: SubtitleModelWithIndex[];
    private lastLoadedMessageTimestamp: number;
    private lastOffsetChangeTimestamp: number;
    private showingOffset?: number;
    private subtitlesInterval?: number;
    private showingLoadedMessage: boolean;
    private subtitleSettings?: SubtitleSettings;
    private subtitleStyles?: string[];
    private subtitleClasses?: string[];
    private notificationElementOverlayHideTimeout?: NodeJS.Timeout;

    private _subtitles: SubtitleModelWithIndex[];
    private subtitleCollection: SubtitleCollection<SubtitleModelWithIndex>;
    private bottomSubtitlesElementOverlay: ElementOverlay;
    private topSubtitlesElementOverlay: ElementOverlay;
    private notificationElementOverlay: ElementOverlay;
    private shouldRenderBottomOverlay: boolean;
    private shouldRenderTopOverlay: boolean;
    private subtitleTrackAlignments: { [key: number]: SubtitleAlignment };
    private unblurredSubtitleTracks: { [key: number]: boolean };
    public disabledSubtitleTracks: { [key: number]: boolean };
    public subtitleFileNames?: string[];

    private _forceHideSubtitles: boolean;
    private _displaySubtitles: boolean;

    public surroundingSubtitlesCountRadius: number;
    public surroundingSubtitlesTimeRadius: number;
    public autoCopyCurrentSubtitle: boolean;
    public convertNetflixRuby: boolean;
    public subtitleHtml: SubtitleHtml;

    public readonly autoPauseContext: AutoPauseContext;
    public onNextToShow?: (subtitle: SubtitleModel) => void;
    public onSlice?: (slice: SubtitleSlice<SubtitleModelWithIndex>) => void;
    public onOffsetChange?: () => void;
    public onMouseOver?: (event: MouseEvent) => void;

    constructor(video: HTMLMediaElement, settings: SettingsProvider) {
        this.video = video;
        this.settings = settings;
        this._subtitles = [];
        this.subtitleCollection = new SubtitleCollection([]);
        this.showingSubtitles = [];
        this.shouldRenderBottomOverlay = true;
        this.shouldRenderTopOverlay = false;
        this.unblurredSubtitleTracks = {};
        this.disabledSubtitleTracks = {};
        this.subtitleTrackAlignments = { 0: 'bottom' };
        this._forceHideSubtitles = false;
        this._displaySubtitles = true;
        this.lastLoadedMessageTimestamp = 0;
        this.lastOffsetChangeTimestamp = 0;
        this.showingOffset = undefined;
        this.surroundingSubtitlesCountRadius = 1;
        this.surroundingSubtitlesTimeRadius = 5000;
        this.showingLoadedMessage = false;
        this.autoCopyCurrentSubtitle = false;
        this.convertNetflixRuby = false;
        this.subtitleHtml = SubtitleHtml.remove;
        this.autoPauseContext = new AutoPauseContext();

        const { subtitlesElementOverlay, topSubtitlesElementOverlay, notificationElementOverlay } = this._overlays();
        this.bottomSubtitlesElementOverlay = subtitlesElementOverlay;
        this.topSubtitlesElementOverlay = topSubtitlesElementOverlay;
        this.notificationElementOverlay = notificationElementOverlay;
    }

    get subtitles() {
        return this._subtitles;
    }

    set subtitles(subtitles: SubtitleModelWithIndex[]) {
        this._subtitles = subtitles;
        this.subtitleCollection = new SubtitleCollection(subtitles, {
            showingCheckRadiusMs: 150,
            returnNextToShow: true,
        });
        this.autoPauseContext.clear();
    }

    reset() {
        this.subtitles = [];
        this.subtitleFileNames = undefined;
        this.cacheHtml();
    }

    cacheHtml() {
        const html = this._buildSubtitlesHtml(this.subtitles);

        if (this.shouldRenderBottomOverlay && this.bottomSubtitlesElementOverlay instanceof CachingElementOverlay) {
            this.bottomSubtitlesElementOverlay.uncacheHtml();

            for (const h of html) {
                this.bottomSubtitlesElementOverlay.cacheHtml(h.key as string, h.html());
            }
        }

        if (this.shouldRenderTopOverlay && this.topSubtitlesElementOverlay instanceof CachingElementOverlay) {
            this.topSubtitlesElementOverlay.uncacheHtml();

            for (const h of html) {
                this.topSubtitlesElementOverlay.cacheHtml(h.key as string, h.html());
            }
        }
    }

    get bottomSubtitlePositionOffset() {
        return this.bottomSubtitlesElementOverlay.contentPositionOffset;
    }

    set bottomSubtitlePositionOffset(offset: number) {
        this.bottomSubtitlesElementOverlay.contentPositionOffset = offset;
    }

    get topSubtitlePositionOffset() {
        return this.topSubtitlesElementOverlay.contentPositionOffset;
    }

    set topSubtitlePositionOffset(offset: number) {
        this.topSubtitlesElementOverlay.contentPositionOffset = offset;
    }

    set subtitlesWidth(width: number) {
        this.bottomSubtitlesElementOverlay.contentWidthPercentage = width;
        this.topSubtitlesElementOverlay.contentWidthPercentage = width;
    }

    setSubtitleSettings(settings: SubtitleSettings) {
        const subtitleStyles = this._computeStyles(settings);
        const subtitleClasses = this._computeClasses(settings);

        if (
            this.subtitleStyles === undefined ||
            !this._arrayEquals(subtitleStyles, this.subtitleStyles, (a, b) => a === b) ||
            this.subtitleClasses === undefined ||
            !this._arrayEquals(subtitleClasses, this.subtitleClasses, (a, b) => a === b)
        ) {
            this.subtitleStyles = subtitleStyles;
            this.subtitleClasses = subtitleClasses;
            this.cacheHtml();
        }

        const alignments = allTextSubtitleSettings(settings).map((s) => s.subtitleAlignment);

        if (!this._arrayEquals(alignments, Object.values(this.subtitleTrackAlignments), (a, b) => a === b)) {
            this.subtitleTrackAlignments = alignments;
            this.shouldRenderBottomOverlay = Object.values(this.subtitleTrackAlignments).includes('bottom');
            this.shouldRenderTopOverlay = Object.values(this.subtitleTrackAlignments).includes('top');
            const { subtitleOverlayParams, topSubtitleOverlayParams, notificationOverlayParams } =
                this._elementOverlayParams();
            this._applyElementOverlayParams(this.bottomSubtitlesElementOverlay, subtitleOverlayParams);
            this._applyElementOverlayParams(this.topSubtitlesElementOverlay, topSubtitleOverlayParams);
            this._applyElementOverlayParams(this.notificationElementOverlay, notificationOverlayParams);
            this.bottomSubtitlesElementOverlay.hide();
            this.topSubtitlesElementOverlay.hide();
            this.notificationElementOverlay.hide();
        }

        this.unblurredSubtitleTracks = {};
        this.subtitleSettings = settings;
    }

    private _computeStyles(settings: SubtitleSettings) {
        return allTextSubtitleSettings(settings).map((s) => computeStyleString(s));
    }

    private _computeClasses(settings: SubtitleSettings) {
        return allTextSubtitleSettings(settings).map((s) => this._computeClassesForTrack(s));
    }

    private _computeClassesForTrack(settings: TextSubtitleSettings) {
        if (settings.subtitleBlur) {
            return 'asbplayer-subtitles-blurred';
        }

        return '';
    }

    private _getSubtitleTrackAlignment(track: number) {
        return this.subtitleTrackAlignments[track] || this.subtitleTrackAlignments[0];
    }

    private _applyElementOverlayParams(overlay: ElementOverlay, params: ElementOverlayParams) {
        overlay.offsetAnchor = params.offsetAnchor;
        overlay.fullscreenContainerClassName = params.fullscreenContainerClassName;
        overlay.fullscreenContentClassName = params.fullscreenContentClassName;
        overlay.nonFullscreenContainerClassName = params.nonFullscreenContainerClassName;
        overlay.nonFullscreenContentClassName = params.nonFullscreenContentClassName;
    }

    set displaySubtitles(displaySubtitles: boolean) {
        this._displaySubtitles = displaySubtitles;
        this.showingSubtitles = undefined;
    }

    set forceHideSubtitles(forceHideSubtitles: boolean) {
        this._forceHideSubtitles = forceHideSubtitles;
        this.showingSubtitles = undefined;
    }

    private _overlays() {
        const { subtitleOverlayParams, topSubtitleOverlayParams, notificationOverlayParams } =
            this._elementOverlayParams();
        return {
            subtitlesElementOverlay: new CachingElementOverlay(subtitleOverlayParams),
            topSubtitlesElementOverlay: new CachingElementOverlay(topSubtitleOverlayParams),
            notificationElementOverlay: new CachingElementOverlay(notificationOverlayParams),
        };
    }

    private _elementOverlayParams(): {
        subtitleOverlayParams: ElementOverlayParams;
        topSubtitleOverlayParams: ElementOverlayParams;
        notificationOverlayParams: ElementOverlayParams;
    } {
        const subtitleOverlayParams: ElementOverlayParams = {
            targetElement: this.video,
            nonFullscreenContainerClassName: 'asbplayer-subtitles-container-bottom',
            nonFullscreenContentClassName: 'asbplayer-subtitles',
            fullscreenContainerClassName: 'asbplayer-subtitles-container-bottom',
            fullscreenContentClassName: 'asbplayer-fullscreen-subtitles',
            offsetAnchor: OffsetAnchor.bottom,
            contentWidthPercentage: -1,
            onMouseOver: (e) => this.onMouseOver?.(e),
        };
        const topSubtitleOverlayParams: ElementOverlayParams = {
            targetElement: this.video,
            nonFullscreenContainerClassName: 'asbplayer-subtitles-container-top',
            nonFullscreenContentClassName: 'asbplayer-subtitles',
            fullscreenContainerClassName: 'asbplayer-subtitles-container-top',
            fullscreenContentClassName: 'asbplayer-fullscreen-subtitles',
            offsetAnchor: OffsetAnchor.top,
            contentWidthPercentage: -1,
            onMouseOver: (e) => this.onMouseOver?.(e),
        };
        const notificationOverlayParams: ElementOverlayParams =
            this._getSubtitleTrackAlignment(0) === 'bottom'
                ? {
                      targetElement: this.video,
                      nonFullscreenContainerClassName: 'asbplayer-notification-container-top',
                      nonFullscreenContentClassName: 'asbplayer-notification',
                      fullscreenContainerClassName: 'asbplayer-notification-container-top',
                      fullscreenContentClassName: 'asbplayer-notification',
                      offsetAnchor: OffsetAnchor.top,
                      contentWidthPercentage: -1,
                      onMouseOver: (e) => this.onMouseOver?.(e),
                  }
                : {
                      targetElement: this.video,
                      nonFullscreenContainerClassName: 'asbplayer-notification-container-bottom',
                      nonFullscreenContentClassName: 'asbplayer-notification',
                      fullscreenContainerClassName: 'asbplayer-notification-container-bottom',
                      fullscreenContentClassName: 'asbplayer-notification',
                      offsetAnchor: OffsetAnchor.bottom,
                      contentWidthPercentage: -1,
                      onMouseOver: (e) => this.onMouseOver?.(e),
                  };
        return { subtitleOverlayParams, topSubtitleOverlayParams, notificationOverlayParams };
    }

    bind() {
        this.subtitlesInterval = setInterval(() => {
            if (
                this.lastLoadedMessageTimestamp > 0 &&
                Date.now() - this.lastLoadedMessageTimestamp < 1000 &&
                !this.showingLoadedMessage
            ) {
                return;
            }

            if (this.showingLoadedMessage) {
                this._setSubtitlesHtml(this.bottomSubtitlesElementOverlay, [{ html: () => '' }]);
                this._setSubtitlesHtml(this.topSubtitlesElementOverlay, [{ html: () => '' }]);
                this.showingLoadedMessage = false;
            }

            if (this.subtitles.length === 0) {
                return;
            }

            const showOffset = this.lastOffsetChangeTimestamp > 0 && Date.now() - this.lastOffsetChangeTimestamp < 1000;
            const offset = showOffset ? this._computeOffset() : 0;
            const now = 1000 * this.video.currentTime;
            let subtitles: SubtitleModelWithIndex[] = [];

            const subs = this.subtitleCollection.subtitlesAt(now);

            subtitles = subs.showing.filter((s) => this._trackEnabled(s)).sort((s1, s2) => s1.track - s2.track);

            this.onSlice?.(subs);

            if (subs.willStopShowing && this._trackEnabled(subs.willStopShowing)) {
                this.autoPauseContext.willStopShowing(subs.willStopShowing);
            }

            if (subs.startedShowing && this._trackEnabled(subs.startedShowing)) {
                this.autoPauseContext.startedShowing(subs.startedShowing);
            }

            if (subs.nextToShow && subs.nextToShow.length > 0) {
                this.onNextToShow?.(subs.nextToShow[0]);
            }

            const subtitlesChanged =
                this.showingSubtitles === undefined ||
                !this._arrayEquals(subtitles, this.showingSubtitles, (s1, s2) => s1.index === s2.index);

            if (subtitlesChanged) {
                this.showingSubtitles = subtitles;
                this._autoCopyToClipboard(subtitles);
            }

            const offsetChanged =
                (showOffset && offset !== this.showingOffset) || (!showOffset && this.showingOffset !== undefined);

            if ((!showOffset && !this._displaySubtitles) || this._forceHideSubtitles) {
                this.bottomSubtitlesElementOverlay.hide();
                this.topSubtitlesElementOverlay.hide();
            } else if (subtitlesChanged || offsetChanged) {
                this._resetUnblurState();

                if (this.shouldRenderBottomOverlay) {
                    const bottomSubtitles = subtitles.filter(
                        (s) => this._getSubtitleTrackAlignment(s.track) === 'bottom'
                    );
                    this._renderSubtitles(bottomSubtitles, OffsetAnchor.bottom);
                }

                if (this.shouldRenderTopOverlay) {
                    const topSubtitles = subtitles.filter((s) => this._getSubtitleTrackAlignment(s.track) === 'top');
                    this._renderSubtitles(topSubtitles, OffsetAnchor.top);
                }

                if (showOffset) {
                    this._appendSubtitlesHtml(this._buildTextHtml(this._formatOffset(offset)));
                    this.showingOffset = offset;
                } else {
                    this.showingOffset = undefined;
                }
            }
        }, 100) as unknown as number;
    }

    private _renderSubtitles(subtitles: SubtitleModelWithIndex[], anchor: OffsetAnchor) {
        const html = this._buildSubtitlesHtml(subtitles);

        if (anchor == OffsetAnchor.top) {
            this._setSubtitlesHtml(this.topSubtitlesElementOverlay, html);
        } else {
            this._setSubtitlesHtml(this.bottomSubtitlesElementOverlay, html);
        }
    }

    private _resetUnblurState() {
        if (Object.keys(this.unblurredSubtitleTracks).length === 0) {
            return;
        }

        const elements = [
            ...this.bottomSubtitlesElementOverlay.displayingElements(),
            ...this.topSubtitlesElementOverlay.displayingElements(),
        ];

        for (const element of elements) {
            const track = Number((element as HTMLElement).dataset.track);
            if (this.unblurredSubtitleTracks[track] === true) {
                element.classList.add('asbplayer-subtitles-blurred');
            }
        }

        this.unblurredSubtitleTracks = {};
    }

    private _autoCopyToClipboard(subtitles: SubtitleModel[]) {
        if (!this.autoCopyCurrentSubtitle || subtitles.length === 0 || !document.hasFocus()) {
            return;
        }

        const text = subtitles
            .map((s) => s.text)
            .filter((s) => s !== '')
            .join('\n');

        if (text === '') {
            return;
        }

        const message: VideoToExtensionCommand<CopyToClipboardMessage> = {
            sender: 'asbplayer-video',
            message: {
                command: 'copy-to-clipboard',
                dataUrl: `data:,${encodeURIComponent(text)}`,
            },
            src: this.video.src,
        };
        chrome.runtime.sendMessage(message);
    }

    private _trackEnabled(subtitle: SubtitleModel) {
        return subtitle.track === undefined || !this.disabledSubtitleTracks[subtitle.track];
    }

    private _buildSubtitlesHtml(subtitles: SubtitleModelWithIndex[]): KeyedHtml[] {
        return subtitles.map((subtitle) => {
            return {
                html: () => {
                    if (subtitle.textImage) {
                        const extraClasses = this.subtitleClasses?.[subtitle.track] ?? '';
                        const scale =
                            (this.subtitleSettings?.imageBasedSubtitleScaleFactor ?? 1) *
                            (this.video.getBoundingClientRect().width / subtitle.textImage.screen.width);
                        const width = scale * subtitle.textImage.image.width;
                        return `
                            <div data-track="${subtitle.track ?? 0}" style="max-width:${width}px;margin:auto;" class="${extraClasses}"}">
                                <img
                                    style="width:100%;"
                                    alt="subtitle"
                                    src="${subtitle.textImage.dataUrl}"
                                />
                            </div>
                        `;
                    }

                    return this._buildTextHtml(subtitle.text, subtitle.track);
                },
                key: String(subtitle.index),
            };
        });
    }

    private _buildTextHtml(text: string, track?: number) {
        return `<span data-track="${track ?? 0}" class="${this._subtitleClasses(track)}" style="${this._subtitleStyles(track)}">${text}</span>`;
    }

    unbind() {
        if (this.subtitlesInterval) {
            clearInterval(this.subtitlesInterval);
            this.subtitlesInterval = undefined;
        }

        if (this.notificationElementOverlayHideTimeout) {
            clearTimeout(this.notificationElementOverlayHideTimeout);
            this.notificationElementOverlayHideTimeout = undefined;
        }

        this.bottomSubtitlesElementOverlay.dispose();
        this.topSubtitlesElementOverlay.dispose();
        this.notificationElementOverlay.dispose();

        this.onNextToShow = undefined;
        this.onSlice = undefined;
        this.onOffsetChange = undefined;
        this.onMouseOver = undefined;
    }

    refresh() {
        if (this.shouldRenderBottomOverlay) this.bottomSubtitlesElementOverlay.refresh();
        if (this.shouldRenderTopOverlay) this.topSubtitlesElementOverlay.refresh();
        this.notificationElementOverlay.refresh();
    }

    currentSubtitle(): [SubtitleModelWithIndex | null, SubtitleModelWithIndex[] | null] {
        const now = 1000 * this.video.currentTime;
        let subtitle = null;
        let index = null;

        for (let i = 0; i < this.subtitles.length; ++i) {
            const s = this.subtitles[i];
            if (
                now >= s.start &&
                now < s.end &&
                (typeof s.track === 'undefined' || !this.disabledSubtitleTracks[s.track])
            ) {
                subtitle = s;
                index = i;
                break;
            }
        }

        if (subtitle === null || index === null) {
            return [null, null];
        }

        return [
            subtitle,
            surroundingSubtitles(
                this.subtitles,
                index,
                this.surroundingSubtitlesCountRadius,
                this.surroundingSubtitlesTimeRadius
            ) as SubtitleModelWithIndex[],
        ];
    }

    unblur(track: number) {
        const elements = [
            ...this.bottomSubtitlesElementOverlay.displayingElements(),
            ...this.topSubtitlesElementOverlay.displayingElements(),
        ];

        for (const element of elements) {
            const elementTrack = Number((element as HTMLElement).dataset.track);
            if (track === elementTrack && element.classList.contains('asbplayer-subtitles-blurred')) {
                this.unblurredSubtitleTracks[track] = true;
                element.classList.remove('asbplayer-subtitles-blurred');
            }
        }
    }

    offset(offset: number, echo = false) {
        if (!this.subtitles || this.subtitles.length === 0) {
            return;
        }

        this.subtitles = this.subtitles.map((s) => ({
            text: s.text,
            textImage: s.textImage,
            start: s.originalStart + offset,
            originalStart: s.originalStart,
            end: s.originalEnd + offset,
            originalEnd: s.originalEnd,
            track: s.track,
            index: s.index,
        }));
        this.lastOffsetChangeTimestamp = Date.now();

        if (!echo) {
            const command: VideoToExtensionCommand<OffsetToVideoMessage> = {
                sender: 'asbplayer-video',
                message: {
                    command: 'offset',
                    value: offset,
                },
                src: this.video.src,
            };
            chrome.runtime.sendMessage(command);
        }

        // Notify that offset has changed (allows SyncController to pick it up)
        this.onOffsetChange?.();
        this.settings.getSingle('rememberSubtitleOffset').then((remember) => {
            if (remember) {
                this.settings.set({ lastSubtitleOffset: offset });
            }
        });

        // Dispatch event for other controllers to listen to (Critical for Sync Controller saving)
        this.video.dispatchEvent(new CustomEvent('asbplayer-offset-change', { detail: { offset } }));
    }

    private _computeOffset(): number {
        if (!this.subtitles || this.subtitles.length === 0) {
            return 0;
        }

        const s = this.subtitles[0];
        return s.start - s.originalStart;
    }

    private _formatOffset(offset: number) {
        const roundedOffset = Math.floor(offset);
        return roundedOffset >= 0 ? '+' + roundedOffset + ' ms' : roundedOffset + ' ms';
    }

    notification(messageLocKey: string, replacements?: any) {
        const message = i18n.t(messageLocKey, replacements ?? {}) as string;
        this.notificationElementOverlay.setHtml([{ html: () => this._buildTextHtml(message) }]);
        if (this.notificationElementOverlayHideTimeout) {
            clearTimeout(this.notificationElementOverlayHideTimeout);
        }
        this.notificationElementOverlayHideTimeout = setTimeout(() => {
            this.notificationElementOverlay.hide();
            this.notificationElementOverlayHideTimeout = undefined;
        }, 3000);
    }

    showLoadedMessage(tracks: number[]) {
        if (!this.subtitleFileNames) {
            return;
        }

        const subtitleFileNames = this._nonEmptySubtitleNames(tracks);
        let message;

        if (subtitleFileNames.length === 0) {
            message = this.subtitleFileNames[0];
        } else {
            message = subtitleFileNames.join('<br>');
        }

        if (this.subtitles.length > 0) {
            const offset = this.subtitles[0].start - this.subtitles[0].originalStart;
            if (offset !== 0) {
                message += `<br>${this._formatOffset(offset)}`;
            }
        }

        const overlay =
            this._getSubtitleTrackAlignment(0) === 'bottom'
                ? this.bottomSubtitlesElementOverlay
                : this.topSubtitlesElementOverlay;
        this._setSubtitlesHtml(overlay, [{ html: () => this._buildTextHtml(message) }]);
        this.showingLoadedMessage = true;
        this.lastLoadedMessageTimestamp = Date.now();
    }

    private _nonEmptySubtitleNames(tracks: number[]) {
        if (tracks.length === 0) {
            return [];
        }

        const names = [];
        for (let i = 0; i < tracks.length; i++) {
            names.push(this.subtitleFileNames![tracks[i]]);
        }
        return names;
    }

    private _setSubtitlesHtml(overlay: ElementOverlay, html: KeyedHtml[]) {
        overlay.setHtml(html);
    }

    private _appendSubtitlesHtml(html: string) {
        if (this.shouldRenderBottomOverlay) this.bottomSubtitlesElementOverlay.appendHtml(html);
        if (this.shouldRenderTopOverlay) this.topSubtitlesElementOverlay.appendHtml(html);
    }

    private _subtitleClasses(track?: number) {
        if (track === undefined || this.subtitleClasses === undefined) {
            return '';
        }

        return this.subtitleClasses[track] ?? this.subtitleClasses;
    }

    private _subtitleStyles(track?: number) {
        if (this.subtitleStyles === undefined) {
            return '';
        }

        if (track === undefined) {
            return this.subtitleStyles[0] ?? '';
        }

        return this.subtitleStyles[track] ?? this.subtitleStyles[0] ?? '';
    }

    private _arrayEquals<T>(a: T[], b: T[], equals: (lhs: T, rhs: T) => boolean): boolean {
        if (a.length !== b.length) {
            return false;
        }

        for (let i = 0; i < a.length; ++i) {
            if (!equals(a[i], b[i])) {
                return false;
            }
        }

        return true;
    }

    intersects(clientX: number, clientY: number): boolean {
        const bottomContainer = this.bottomSubtitlesElementOverlay.containerElement;

        if (bottomContainer !== undefined && _intersects(clientX, clientY, bottomContainer)) {
            return true;
        }

        const topContainer = this.topSubtitlesElementOverlay.containerElement;

        if (topContainer !== undefined && _intersects(clientX, clientY, topContainer)) {
            return true;
        }

        return false;
    }
}
