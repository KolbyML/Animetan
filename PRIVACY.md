# Privacy Policy for Animetan

**Last updated:** [Date]

The Animetan extension ("we", "us", or "our") is committed to protecting your privacy. This policy explains how your information is handled.

## 1. Data Collection

We do not collect, store, or transmit any personally identifiable information (PII) or user data to our own servers. The extension operates entirely client-side within your browser.

## 2. Data Usage

The extension uses your data solely for the following functional purposes:

- **Settings & Preferences:** Your configuration settings (e.g., offsets, keybinds) and API keys are stored locally on your device using `chrome.storage`.
- **Third-Party Services:**
    - **Anilist API:** To identify anime titles and episodes, the extension sends search queries derived from the current page title to Anilist.
    - **Jimaku API:** To fetch subtitles, the extension sends your Jimaku API key and anime metadata to the Jimaku API.
- **AnkiConnect:** Audio clips, screenshots, and text you explicitly capture are sent directly to your local Anki installation via localhost.

## 3. Data Sharing

We do not sell, trade, or otherwise transfer your data to outside parties. Data is only shared with the specific third-party services listed above (Anilist, Jimaku) as required to perform the actions you request (e.g., searching for a subtitle).

## 4. Permissions

The extension requires permission to access website data (`<all_urls>`) to detect video players and inject subtitles. This access is performed locally in your browser and URL data is not collected by the developer.

## 5. Contact

If you have questions about this policy, please open an issue on our GitHub repository.
