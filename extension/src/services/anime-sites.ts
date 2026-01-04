interface AnimeSiteConfig {
    titleQuery: string;
    epQuery: string;
    pathPattern: RegExp;
    syncData?: string | null;
    extractInfo: () => { title: string; episode: string; anilistId?: number | null };
}

const DOMAIN_BLOCKLIST = [
    'youtube.com',
    'youtu.be',
    'myanimelist.net',
    'anilist.co',
    'reddit.com',
    'google.com',
    'facebook.com',
    'twitter.com',
    'x.com',
    'twitch.tv',
    'netflix.com',
    'crunchyroll.com',
    'disneyplus.com',
    'hulu.com',
    'primevideo.com'
];

const SITE_CONFIGS: AnimeSiteConfig[] = [
    {
        titleQuery: 'h2.film-name > a',
        epQuery: '.ssl-item.ep-item.active',
        pathPattern: /\/watch\/[^/]+\?ep=.+/,
        syncData: '#syncData',
        extractInfo: () => {
            const titleElement = document.querySelector('h2.film-name > a');
            let epElement = document.querySelector('.ssl-item.ep-item.active');
            let episode = epElement?.getAttribute('data-number') || epElement?.textContent?.trim() || '';

            if (!episode) {
                const titleMatch = document.title.match(/Episode\s+(\d+)/i);
                if (titleMatch) {
                    episode = titleMatch[1];
                }
            }

            return {
                title: titleElement?.textContent?.trim() || '',
                episode: episode,
            };
        },
    },
    {
        titleQuery: '.anime-title > a',
        epQuery: '',
        pathPattern: /\/watch(?:\/\d+\/[^/]+\/episode-\d+|\?id=.+ep=.+)/,
        extractInfo: () => {
            const titleElement = document.querySelector('.anime-title > a');
            const pathMatch = window.location.href.match(/watch\/(\d+)\/([^/]+)\/episode-(\d+)/);
            if (pathMatch) {
                const [, anilistId, title, episode] = pathMatch;
                return {
                    title: title,
                    episode: episode,
                    anilistId: parseInt(anilistId),
                };
            }
            const urlParams = new URLSearchParams(window.location.search);
            const episodeString = urlParams.get('ep');
            const anilistId = urlParams.get('id');

            return {
                title: titleElement?.textContent?.trim() || '',
                episode: episodeString || '',
                anilistId: anilistId ? parseInt(anilistId) : null,
            };
        },
    },
    {
        titleQuery: '.fallback.ng-binding',
        epQuery: 'title',
        pathPattern: /\/[^/]+\/.+/,
        extractInfo: () => {
            const titleElement = document.querySelector('.fallback.ng-binding');
            const title = titleElement?.textContent?.trim() || '';
            const titleTag = document.querySelector('title');
            const titleText = titleTag?.textContent || '';
            
            const episodeMatch = titleText.match(/(\d+)x(\d+)/);
            let episode = '';
            if (episodeMatch && episodeMatch[2]) {
                episode = episodeMatch[2];
            }
            return {
                title,
                episode,
            };
        },
    },
    {
        titleQuery: '',
        epQuery: '',
        pathPattern: /\/watch\/[^#]+#ep=\d+/,
        extractInfo: () => {
            const url = window.location.href;
            const match = url.match(/\/watch\/([^#]+)#ep=(\d+)/);
            if (!match) return { title: '', episode: '' };
            const [, titleSlug, episode] = match;
            const titleParts = titleSlug.split('-');
            const title = titleParts.slice(0, -1).join(' ').trim();
            return {
                title,
                episode,
            };
        },
    },
];

interface AnimeInfoResult {
    title: string;
    episode: number | '';
    error?: string;
    anilistId?: number;
}

export function getAnimeTitleAndEpisode(url: string, maxRetries = 5, delay = 1000): Promise<AnimeInfoResult> {
    return new Promise((resolve, reject) => {
        const attempt = (retryCount: number) => {
            if (isBlockedDomain(url)) {
                reject({ title: '', episode: '', error: 'Site is blocklisted.' });
                return;
            }

            for (const config of SITE_CONFIGS) {
                if (config.pathPattern.test(url)) {
                    try {
                        const info = config.extractInfo();
                        if (info.title && info.episode) {
                            resolve({
                                title: info.title,
                                episode: parseInt(info.episode, 10),
                                ...(info.anilistId ? { anilistId: info.anilistId } : {}),
                            });
                            return;
                        }
                    } catch (e) {
                    }
                }
            }

            if (retryCount < maxRetries) {
                setTimeout(() => attempt(retryCount + 1), delay);
            } else {
                reject({
                    title: '',
                    episode: '',
                    error: "Couldn't identify the correct Anime Title and Episode on this site.",
                });
            }
        };

        attempt(0);
    });
}

function isBlockedDomain(url: string): boolean {
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        return DOMAIN_BLOCKLIST.some(blocked => hostname.includes(blocked));
    } catch {
        return true;
    }
}

export function isAnimeSite(url: string): boolean {
    if (isBlockedDomain(url)) return false;
    
    return SITE_CONFIGS.some(config => config.pathPattern.test(url));
}

export function getAnimeSiteInfo(url: string) {
    if (isBlockedDomain(url)) return undefined;
    return SITE_CONFIGS.find(config => config.pathPattern.test(url));
}

export function animeSiteInitConfig(
    hostname: string,
    referrer: string | undefined
): {
    isReferredFromAnimeSite: boolean;
    referrerHostname: string | undefined;
} {
    if (isBlockedDomain(`https://${hostname}`)) {
        return { isReferredFromAnimeSite: false, referrerHostname: undefined };
    }

    const referrerHostname = referrer ? new URL(referrer).hostname : undefined;
    let isReferredFromAnimeSite = false;

    if (referrer) {
        isReferredFromAnimeSite = SITE_CONFIGS.some(config => config.pathPattern.test(referrer));
    }

    return {
        isReferredFromAnimeSite,
        referrerHostname,
    };
}
