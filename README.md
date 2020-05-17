# Valorant Watcher

Simple puppeteer-based node.js application which watches Valorant livestreams for you.

## Features

- Cookie-based login
- Random drop-enabled streamer
- Muted audio
- Bypass "mature content" streams
- Automatic lowest possible resolution settings to save bandwith
- Avoid wasting time on offline streams or streams with errors
- Avoid wasting bandwidth when you've already got the drop
- Avoid watching streamers which are playing valorant but don't have drops enabled

## Setup

1. Install [Chrome Canary](https://www.google.com/chrome/canary/)  
   Make sure you get Chrome Canary! Regular Chrome does not support the automation library we use and Chromium does not support the video formats needed for twitch
2. Install [node.js](https://nodejs.org/en/download/) and [NPM](https://www.npmjs.com/get-npm)
3. Open your regular browser and log into twitch.tv
4. Open the inspector with Ctrl+Shift+I and copy the `auth-token` cookie
5. Find out the path to your Chrome Canary executable
6. Clone the repo
7. Create a `config.json` file and replace the {PLACEHOLDERS}
   ```json
   {
     "token": "{YOUR AUTH COOKIE TOKEN}",
     "exec": "{PATH TO CHROME CANARY EXECUTABLE}"
   }
   ```
8. Run `npm install`

## Usage

To run, you simply need to open a terminal (or powershell) window in the directory of the repo and type `npm start`

You'll get some diagnostic messages, and should a browser window not open you should check if you have the drop! :)

If you don't have the drop but the browser doesn't start or you get an error, feel free to create a GitHub issue :D

## Donations

This code is a fork of another repo, if you want to support the original dev you can donate to him here:

<a href="https://www.buymeacoffee.com/D3v" target="_blank"><img src="https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png" alt="Buy Me A Coffee" style="height: 41px !important;width: 174px !important;box-shadow: 0px 3px 2px 0px rgba(190, 190, 190, 0.5) !important;-webkit-box-shadow: 0px 3px 2px 0px rgba(190, 190, 190, 0.5) !important;" ></a>
