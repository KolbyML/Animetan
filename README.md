# API subs for asbplayer

Automate your language learning workflow by synchronizing subtitles with your favorite streaming video players. Set your preferences once, and the extension handles the rest.
Set up your subtitle provider and offset once at the start of each season, and have it automatically apply to all episodes of that show!

## Extension Installation

🦊 Firefox Addon: https://addons.mozilla.org/en-CA/firefox/addon/api-subs-for-asbplayer/

🌐 Chrome extension: https://chromewebstore.google.com/detail/api-subs-for-asbplayer/ncfciojfgalkgpnemgndcoibdpcgbpfc

<details>
<summary>Instructions for installing via the assets </summary>

1. Go to the [Releases](https://github.com/zakwarsame/asbplayer/releases) page
2. Find the latest release
3. Under "Assets", download the appropriate file:
    - For Chrome/Chromium browsers: `projectextension-x.x.x-chromium.zip`
    - For Firefox based browsers: `projectextension-1.0.3-firefox-android.zip`

4. Install in your browser:
    - **Chrome/Chromium**:
        - Go to `chrome://extensions/`
        - Enable "Developer mode" (top right)
        - Drag and drop the downloaded ZIP file into the extensions page OR click "Load unpacked" and select the extracted folder
    - **Firefox**:
        - Go to `about:addons`
        - Click the gear icon and select "Install Add-on From File..."
        - Select the downloaded `.zip` file (do not extract it)

 </details>

## Setup

1. Get an API key from [jimaku.cc](https://jimaku.cc)
    - You can get a free key by signing up on the site: https://jimaku.cc/account
    - Generate an API key under the "API" heading and copy it
2. Open asbplayer settings, click on the "Misc" tab and enter your API key in the "API Key" field

## Usage

1. Navigate to a supported video streaming platform.
2. Open the video you wish to watch.
3. A popup will appear requesting your API key (if not already configured) instructions are provided within the popup.
4. The media title and episode number are automatically detected.
5. Click **Search** to find available subtitle tracks.
6. The selected subtitle track is loaded into the player automatically.
7. Adjust the subtitle offset if necessary.
8. Enjoy your content! The extension remembers your provider preference and timing offsets, applying them automatically to future episodes of the same series.

## Features

### Extension Capabilities

- **Automated Metadata Detection**: Identifies media titles and episode numbers from the page context.
- **Seamless Subtitle Integration**: Fetches and aligns subtitles directly within the player interface.
- **Smart Synchronization**: Memorizes timing offsets per show, eliminating the need to re-sync every episode.
- **Broad Compatibility**: Designed to work with various HTML5 video players and streaming platforms.

### Web App Features

[Click here to view the web app](https://zakwarsame.github.io/asbplayer/)

- **Integrated Search**: A new button in the top left corner allows for quick subtitle lookups.
- **Instant Loading**: Automatically injects found subtitles into the active player instance.

**Extension demo:**

> [!NOTE]
> this demo is a bit outdated. You don't need to click "Search". And if you have `Auto-load detected subtitle` enabled, it picks the first one and loads it as soon as you click on anime.

https://github.com/user-attachments/assets/08be7905-fe75-4ef4-8424-0ea20753e5af

**Web app demo:**

https://github.com/user-attachments/assets/5a7f0c93-5c30-49bc-a816-04441a53bddc

## How it Works

This extension acts as a bridge between the browser's video player and subtitle sources:

1.  **Detection**: Identifies video elements and extracts context metadata (title, episode) from the DOM.
2.  **Resolution**: Matches the media with external databases (e.g., Anilist) to ensure accurate identification.
3.  **Retrieval**: Queries configured subtitle providers for matching text tracks.
4.  **Injection**: Parsed subtitles are loaded into `asbplayer` and synchronized with the video timeline.
5.  **Persistence**: User preferences for timing and providers are saved locally for future sessions.

## Credits

- https://github.com/killergerbah/asbplayer
- https://github.com/zakwarsame
- https://github.com/GodPepe7

## License

MIT License