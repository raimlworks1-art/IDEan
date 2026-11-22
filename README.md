<p align="center">
  <img src="assets/icon.png" width="128" alt="IDEan icon">
</p>

<h1 align="center">IDEan</h1>

<p align="center">A code editor for Android, built with web tech.</p>

## What it is

IDEan is a touch-first code editor that runs fully on your phone. The interface is React, TypeScript and Tailwind, bundled by Vite into a single page and packaged as an APK with Capacitor.

## What it does now

- Tabs, line numbers, code folding, undo and redo
- Find and replace, indent and outdent, autosave toggle
- Syntax highlighting for 17 languages, picked from the file extension: Lua, Luau, JavaScript, JSX, TypeScript, TSX, Python, HTML, CSS, JSON, Java, Kotlin, C, C++, C#, Go, Rust, PHP and Ruby
- Language picker in the status bar, new file and new project dialogs (Luau, Lua, JS, JSX, TS, TSX, Python, HTML, CSS, C, C++, C#)
- Suggestion bar above the keyboard: word completion plus typo fixes such as `retrun` to `return`, applied only when you tap
- File actions on every file and folder: rename, copy, cut, paste, duplicate, delete
- Lua and Luau syntax checks
- Long lines wrap, so the editor only scrolls up and down
- Big files open without freezing, because highlighting only runs on the lines on screen
- Projects panel: create projects, clone from GitHub, open a folder from your phone
- Folder access through Android's own picker, with saves written back to the folder
- Git panel: stage, commit, push, pull and publish to GitHub
- Shows up in Android's "Open with" list for code files

## Coming

- Plugins
- AI support
- Editable colors
- Custom fonts

## Build

GitHub Actions builds a signed release APK. Run the "Build APK" workflow in the Actions tab and download the `idean` artifact.

To build a debug APK on the device, set `ANDROID_HOME` and run:

```bash
./build.sh
```

The APK is written to `IDEan.apk`.

## License

MIT. See [LICENSE](LICENSE).
