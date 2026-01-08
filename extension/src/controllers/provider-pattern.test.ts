/**
 * Test suite for Number Detection and Provider Pattern Recognition.
 * Run using: node provider-pattern.test.js
 */

// --- 1. Shared Logic ---
function parseEpisodeNumber(filename) {
    const jpMatch = filename.match(/第(\d+)話/);
    if (jpMatch) return parseInt(jpMatch[1], 10);
    const sxxExxMatch = filename.match(/S\d+E(\d+)/i);
    if (sxxExxMatch) return parseInt(sxxExxMatch[1], 10);
    const epMatch = filename.match(/(?:Ep|Episode)[\s\.]*(\d+)/i);
    if (epMatch) return parseInt(epMatch[1], 10);
    const looseMatches = [...filename.matchAll(/(?:^|[\s_\-\.\[])(\d{1,4})(?:v\d)?(?:[\s_\-\.\]]|$)/g)];
    for (const match of looseMatches) {
        const val = parseInt(match[1], 10);
        if ([720, 1080, 2160, 264, 265].includes(val)) continue;
        return val;
    }
    return null;
}

class PatternExtractor {
    _addWildcardForVariableTitles(pattern) {
        const anchor = '\\d+';
        const anchorIndex = pattern.indexOf(anchor);
        if (anchorIndex === -1) return `^${pattern}$`;
        const tags = ['WEBRip', 'WEB-DL', 'BluRay', '1080p', '720p', 'x264', 'AAC', 'Amazon', 'Netflix', 'Hi10p'];
        const afterAnchor = pattern.substring(anchorIndex + anchor.length);
        let bestTagIndex = -1;
        for (const tag of tags) {
            const tagRegex = new RegExp(`(\\\\\\\.|\\s|\\\\\\\[)${tag}`, 'i');
            const m = afterAnchor.match(tagRegex);
            if (m && m.index !== undefined) {
                if (bestTagIndex === -1 || m.index < bestTagIndex) bestTagIndex = m.index;
            }
        }
        if (bestTagIndex !== -1) {
             const prefix = pattern.substring(0, anchorIndex + anchor.length);
             const suffix = afterAnchor.substring(bestTagIndex); 
             return `^${prefix}.*?${suffix}$`;
        }
        return `^${pattern}$`;
    }

    extractProviderPattern(filename) {
        const epNum = parseEpisodeNumber(filename);
        let currentPattern = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (epNum === null) return `^${currentPattern}$`;
        let replaced = false;
        const jpMatches = [...filename.matchAll(/第(\d+)話/g)];
        for (const match of jpMatches) {
             const escapedMatch = match[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
             currentPattern = currentPattern.replace(escapedMatch, escapedMatch.replace(/\d+/, '\\d+'));
             replaced = true;
        }
        const sxxMatches = [...filename.matchAll(/S\d+E(\d+)/ig)];
        for (const match of sxxMatches) {
             const escapedMatch = match[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
             currentPattern = currentPattern.replace(escapedMatch, escapedMatch.replace(/\d+/g, '\\d+'));
             replaced = true;
        }
        const looseMatches = [...filename.matchAll(/(?:^|[\s_\-\.\[])(\d{1,4})(?:v\d)?(?:[\s_\-\.\]]|$)/g)];
        for (const match of looseMatches) {
            const val = parseInt(match[1], 10);
            if (val === epNum && ![720, 1080, 2160, 264, 265].includes(val)) {
                 const escapedContext = match[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                 const genericContext = escapedContext.replace(match[1], '\\d+');
                 if (currentPattern.includes(escapedContext)) {
                     currentPattern = currentPattern.replace(escapedContext, genericContext);
                     replaced = true;
                 }
            }
        }
        return replaced ? this._addWildcardForVariableTitles(currentPattern) : `^${currentPattern}$`;
    }
}

// --- Tests ---
const detectionTests = [
    { file: "ワンピース.S02E096.第226話.srt", expected: 226, name: "Japanese Priority over SxxExx" },
    { file: "[VCB-Studio] Sound! Euphonium [07][1080p].srt", expected: 7, name: "Loose Brackets" },
    { file: "Hibike! Euphonium - 01 (720p).ass", expected: 1, name: "Loose Number Filtering" }
];

const patternTests = [
    {
        name: "One Piece Amazon (Japanese Format)",
        source: "ワンピース.S02E078.第208話 フォクシー海賊団とデービーバック！.WEBRip.Amazon.ja-jp[sdh].srt",
        target: "ワンピース.S02E079.第209話 第一回戦！.ぐるり一周ドーナツレース.WEBRip.Amazon.ja-jp[sdh].srt",
        shouldMatch: true
    },
    {
        name: "VCB-Studio (Bracketed Numbers)",
        source: "[VCB-Studio] Sound! Euphonium [05][Hi10p_1080p][x264_flac].srt",
        target: "[VCB-Studio] Sound! Euphonium [07][Hi10p_1080p][x264_flac].srt",
        shouldMatch: true
    }
];

const extractor = new PatternExtractor();
console.log("Running Number Detection Tests...\n");
detectionTests.forEach(t => {
    const result = parseEpisodeNumber(t.file);
    console.log(`${result === t.expected ? '✅' : '❌'} [${t.name}] Got ${result}, expected ${t.expected}`);
});

console.log("\nRunning Provider Pattern Tests...\n");
patternTests.forEach(t => {
    const pattern = extractor.extractProviderPattern(t.source);
    const matches = new RegExp(pattern).test(t.target);
    console.log(`${matches === t.shouldMatch ? '✅' : '❌'} [${t.name}] Matches: ${matches}`);
});