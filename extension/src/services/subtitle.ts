interface Subs {
    name: string;
    url: string;
}

const UNSUPPORTED_SUBTITLE_EXTENSIONS = ['.zip', '.7z', '.rar'];

/**
 * Shared episode parsing logic used for both filtering API results
 * and generating provider patterns.
 */
export function parseEpisodeNumber(filename: string): number | null {
    // Priority 1: Japanese format (e.g. 第226話)
    const jpMatch = filename.match(/第(\d+)話/);
    if (jpMatch) return parseInt(jpMatch[1], 10);

    // Priority 2: Standard SxxExx format (e.g. S02E96)
    const sxxExxMatch = filename.match(/S\d+E(\d+)/i);
    if (sxxExxMatch) return parseInt(sxxExxMatch[1], 10);

    // Priority 3: Explicit "Episode" or "Ep" text
    const epMatch = filename.match(/(?:Ep|Episode)[\s\.]*(\d+)/i);
    if (epMatch) return parseInt(epMatch[1], 10);

    // Priority 4: Loose matching (e.g. " - 05", "[07]", " 40 ")
    const looseMatches = [...filename.matchAll(/(?:^|[\s_\-\.\[])(\d{1,4})(?:v\d)?(?:[\s_\-\.\]]|$)/g)];

    for (const match of looseMatches) {
        const val = parseInt(match[1], 10);
        // Filter out common video metadata to avoid false positives
        if (val === 720 || val === 1080 || val === 2160 || val === 264 || val === 265) {
            continue;
        }
        return val;
    }

    return null;
}

export async function fetchSubtitles(anilistId: number, episode: number, apiKey: string): Promise<Subs[] | string> {
    const BASE_URL = 'https://jimaku.cc/api';
    const jimakuErrors = new Map([
        [400, "Something went wrong! This shouldn't happen"],
        [401, 'Authentication failed. Check your API Key'],
        [404, 'Entry not found'],
        [429, 'You downloaded too many subs in a short amount of time. Try again in a short bit'],
    ]);

    try {
        const searchResponse = await fetch(`${BASE_URL}/entries/search?anilist_id=${anilistId}`, {
            method: 'GET',
            headers: { Authorization: apiKey },
        });

        if (!searchResponse.ok) {
            const error = jimakuErrors.get(searchResponse.status) || 'Something went wrong';
            throw new Error(error);
        }

        const jimakuEntry = await searchResponse.json();
        if (jimakuEntry.length === 0) throw new Error('No subs found for this anime');

        const id = jimakuEntry[0].id;
        // Fetch ALL files for local filtering to avoid API "best-effort" errors
        const filesResponse = await fetch(`${BASE_URL}/entries/${id}/files`, {
            method: 'GET',
            headers: { Authorization: apiKey },
        });

        if (!filesResponse.ok) {
            const error = jimakuErrors.get(filesResponse.status) || 'Something went wrong';
            throw new Error(error);
        }

        let subs: Subs[] = await filesResponse.json();
        const targetEpisode = Number(episode);

        subs = subs.filter((sub) => {
            const url = new URL(sub.url);
            const path = url.pathname;
            const extension = path.split('.').pop() ?? '';

            if (UNSUPPORTED_SUBTITLE_EXTENSIONS.includes(`.${extension}`)) return false;

            // Robust comparison: Ensure both are numbers
            return parseEpisodeNumber(sub.name) === targetEpisode;
        });

        if (subs.length === 0) throw new Error(`No subs for episode ${episode} found`);

        return subs;
    } catch (err) {
        if (err instanceof Error) {
            return err.message;
        }
        return 'An error occurred while fetching subtitles';
    }
}
