# Animetan - ASBPlayer + Automatic Anime Subtitles + Saved Offsets per show

Automate your language learning workflow by synchronizing subtitles with your favorite streaming video players. Set your preferences once, and the extension handles the rest.
Set up your subtitle provider and offset once at the start of each season, and have it automatically apply to all episodes of that show! Switch shows, and the extension remembers your settings for each series.

## Extension Installation

🦊 Firefox Addon:

🌐 Chrome extension:

<details>
<summary>Instructions for installing via the assets </summary>

1. Go to the [Releases](https://github.com/kolbyml/Animetan/releases) page
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

[Click here to view the web app](https://kolbyml.github.io/asbplayer/)

- **Integrated Search**: A new button in the top left corner allows for quick subtitle lookups.
- **Instant Loading**: Automatically injects found subtitles into the active player instance.

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
