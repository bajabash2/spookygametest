# STRANDED - Infinite Showroom (WebXR)

Gorilla-Tag-style VR survival game. Runs in the Meta Quest Browser (or any WebXR browser).

## Play it right now (no APK needed)
1. On your PC, in this folder: `python3 -m http.server 8000`
2. Quest plugged in with USB debugging on: `adb reverse tcp:8000 tcp:8000`
3. Open `http://localhost:8000` in the Quest Browser and press ENTER VR.
   (WebXR needs HTTPS or localhost. Or host the folder on GitHub Pages / Netlify / Cloudflare Pages.)

## Controls
- Hold GRIP to make a hand solid, then push off floors, walls and furniture to move and climb.
- Y/X: build menu. Point with the right controller, trigger = select/place. A = rotate, B = cancel.
- Desktop test mode: WASD, mouse, Space, E menu, R rotate, Q cancel, click.

## Turn it into an APK
1. Host the folder at an HTTPS URL (GitHub Pages is free).
2. Go to https://www.pwabuilder.com, enter the URL, choose "Meta Quest" (Oculus) package, download.
3. Sideload the APK: `adb install stranded.apk` (or use SideQuest). Find it under Unknown Sources.

The game loads Three.js from a CDN; the service worker caches it after the first online launch.
