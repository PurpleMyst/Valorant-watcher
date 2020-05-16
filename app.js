require("dotenv").config();
const puppeteer = require("puppeteer-core");
const dayjs = require("dayjs");
const cheerio = require("cheerio");
const fs = require("fs");
const treekill = require("tree-kill");
const path = require("path");

let run = true;
let shouldSetStreamSettings = true;
let cookie = null;
let streamers = null;

// ========================================== CONFIG SECTION =================================================================
const CONFIG_PATH = "config.json";
const SCREENSHOT_FOLDER = ".\\screenshots\\";
const BASE_URL = "https://www.twitch.tv/";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36";

const STREAMERS_URL =
  "https://www.twitch.tv/directory/game/VALORANT?tl=c2542d6d-cd10-4532-919b-3d19f30a768b";

const SCROLL_DELAY = 2000;
const SCROLL_REPETITIONS = 5;

const MIN_WATCH_MINUTES = 15;
const MAX_WATCH_MINUTES = 30;

const REFRESH_INTERVAL_VALUE = 1;
const REFRESH_INTERVAL_UNIT = "hour";

const SHOW_BROWSER = false;
const TAKE_SCREENSHOTS = true;

const BROWSER_RESTART_TIME_VALUE = 1;
const BROWSER_RESTART_TIME_UNIT = "hour";

const browserConfig = {
  headless: !SHOW_BROWSER,
  args: [
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--no-first-run",
    "--no-zygote",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-setuid-sandbox",
  ],
};

const COOKIE_POLICY_QUERY = 'button[data-a-target="consent-banner-accept"]';
const MATURE_CONTENT_QUERY =
  'button[data-a-target="player-overlay-mature-accept"]';
const SIDEBAR_QUERY = '*[data-test-selector="user-menu__toggle"]';
const USER_STATUS_QUERY = 'span[data-a-target="presence-text"]';
const CHANNELS_QUERY = 'a[data-test-selector*="ChannelLink"]';
const STREAM_PAUSE_QUERY = 'button[data-a-target="player-play-pause-button"]';
const STREAM_SETTINGS_QUERY = '[data-a-target="player-settings-button"]';
const STREAM_QUALITY_SETTING_QUERY =
  '[data-a-target="player-settings-menu-item-quality"]';
const STREAM_QUALITY_QUERY = 'input[data-a-target="tw-radio"]';
// ========================================== CONFIG SECTION =================================================================

async function viewRandomPage(browser, page) {
  let nextStreamerRefresh = dayjs().add(
    REFRESH_INTERVAL_VALUE,
    REFRESH_INTERVAL_UNIT
  );

  let nextBrowserClean = dayjs().add(
    BROWSER_RESTART_TIME_VALUE,
    BROWSER_RESTART_TIME_UNIT
  );

  while (run) {
    // Are we due for a cleaning?
    if (dayjs(nextBrowserClean).isBefore(dayjs())) {
      const newBrowser = await restartBrowser(browser);
      browser = newBrowser.browser;
      page = newBrowser.page;
      shouldSetStreamSettings = true;
      nextBrowserClean = dayjs().add(
        BROWSER_RESTART_TIME_VALUE,
        BROWSER_RESTART_TIME_UNIT
      );
    }

    // Are we due for a streamer refresh?
    if (dayjs(nextStreamerRefresh).isBefore(dayjs())) {
      await getNewStreamers(page);
      nextStreamerRefresh = dayjs().add(
        REFRESH_INTERVAL_VALUE,
        REFRESH_INTERVAL_UNIT
      );
    }

    // Choose a random streamer and watchtime
    const chosenStreamer = streamers[getRandomInt(0, streamers.length - 1)];
    const watchFor = getRandomInt(MIN_WATCH_MINUTES, MAX_WATCH_MINUTES) * 60000;

    // Watch chosen streamer
    console.log("\nNow watching streamer: ", BASE_URL + chosenStreamer);
    await page.goto(BASE_URL + chosenStreamer, { waitUntil: "networkidle0" });

    // Remove annoying popups
    await clickWhenExist(page, COOKIE_POLICY_QUERY);
    await clickWhenExist(page, MATURE_CONTENT_QUERY);

    // If we haven't set the stream settings for this browser yet, do it
    if (shouldSetStreamSettings) {
      console.log("Setting lowest possible resolution..");
      await clickWhenExist(page, STREAM_PAUSE_QUERY);

      await clickWhenExist(page, STREAM_SETTINGS_QUERY);
      await page.waitFor(STREAM_QUALITY_SETTING_QUERY);

      await clickWhenExist(page, STREAM_QUALITY_SETTING_QUERY);
      await page.waitFor(STREAM_QUALITY_QUERY);

      let resolution = await queryOnWebsite(page, STREAM_QUALITY_QUERY);
      resolution = resolution[resolution.length - 1].attribs.id;
      await page.evaluate((resolution) => {
        document.getElementById(resolution).click();
      }, resolution);

      await clickWhenExist(page, STREAM_PAUSE_QUERY);

      // Mute the streamer
      await page.keyboard.press("m");

      shouldSetStreamSettings = false;
    }

    if (TAKE_SCREENSHOTS) {
      await page.waitFor(1000);

      if (!fs.existsSync(SCREENSHOT_FOLDER)) fs.mkdirSync(SCREENSHOT_FOLDER);

      const screenshotName = `${chosenStreamer}.png`;
      const screenshotPath = path.join(SCREENSHOT_FOLDER, screenshotName);

      await page.screenshot({ path: screenshotPath });

      console.log("Screenshot created: " + screenshotPath);
    }

    // Get account statu from sidebar
    await clickWhenExist(page, SIDEBAR_QUERY);
    await page.waitFor(USER_STATUS_QUERY);
    const status = await queryOnWebsite(page, USER_STATUS_QUERY);
    await clickWhenExist(page, SIDEBAR_QUERY);

    console.log(
      "Account status:",
      status[0] ? status[0].children[0].data : "Unknown"
    );
    console.log("Time: " + dayjs().format("HH:mm:ss"));
    console.log("Watching stream for " + watchFor / (60 * 1000) + " minutes\n");

    await page.waitFor(watchFor);
  }
}

async function readLoginData() {
  const cookie = [
    {
      domain: ".twitch.tv",
      hostOnly: false,
      httpOnly: false,
      name: "auth-token",
      path: "/",
      sameSite: "no_restriction",
      secure: true,
      session: false,
      storeId: "0",
      id: 1,
    },
  ];
  console.log("Checking config file...");

  if (fs.existsSync(CONFIG_PATH)) {
    console.log("✅ Json config found!");

    let configFile = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

    browserConfig.executablePath = configFile.exec;
    cookie[0].value = configFile.token;

    return cookie;
  } else {
    console.log("❌ No config file found!");
    process.exit(1);
  }
}

async function spawnBrowser() {
  console.log("=========================");
  console.log("Launching browser...");
  let browser = await puppeteer.launch(browserConfig);
  let page = await browser.newPage();

  console.log("Setting User-Agent...");
  await page.setUserAgent(USER_AGENT);

  console.log("Setting auth token...");
  await page.setCookie(...cookie);

  console.log("⏰ Setting timeouts...");
  page.setDefaultNavigationTimeout(0);
  page.setDefaultTimeout(0);

  return { browser, page };
}

async function getNewStreamers(page) {
  console.log("=========================");
  await page.goto(STREAMERS_URL, { waitUntil: "networkidle0" });
  console.log("Checking login...");
  await checkLogin(page);
  console.log("Checking active streamers...");
  await scroll(page);
  const jquery = await queryOnWebsite(page, CHANNELS_QUERY);
  streamers = new Array();

  console.log("Filtering out html codes...");
  for (let i = 0; i < jquery.length; i++) {
    streamers[i] = jquery[i].attribs.href.split("/")[1];
  }
  return;
}

async function checkLogin(page) {
  let cookieSetByServer = await page.cookies();
  for (let i = 0; i < cookieSetByServer.length; i++) {
    if (cookieSetByServer[i].name == "twilight-user") {
      console.log("✅ Login successful!");
      return true;
    }
  }
  console.log("🛑 Login failed!");
  console.log("Invalid token!");
  console.log(
    "\nPleas ensure that you have a valid twitch auth-token.\nhttps://github.com/D3vl0per/Valorant-watcher#how-token-does-it-look-like"
  );
  fs.unlinkSync(CONFIG_PATH);
  process.exit();
}

async function scroll(page) {
  console.log("Emulating scrolling...");

  for (let i = 0; i < SCROLL_REPETITIONS; i++) {
    await page.evaluate(async () => {
      document
        .getElementsByClassName("scrollable-trigger__wrapper")[0]
        .scrollIntoView();
    });
    await page.waitFor(SCROLL_DELAY);
  }
}

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function clickWhenExist(page, query) {
  let result = await queryOnWebsite(page, query);

  try {
    if (result[0].type == "tag" && result[0].name == "button") {
      await page.click(query);
      await page.waitFor(500);
      return;
    }
  } catch (e) {}
}

async function queryOnWebsite(page, query) {
  let bodyHTML = await page.evaluate(() => document.body.innerHTML);
  let $ = cheerio.load(bodyHTML);
  const jquery = $(query);
  return jquery;
}

async function restartBrowser(browser) {
  const pages = await browser.pages();
  await pages.map((page) => page.close());
  treekill(browser.process().pid, "SIGKILL");
  return await spawnBrowser();
}

async function shutDown() {
  console.log("\nBye Bye");
  run = false;
  process.exit();
}

async function main() {
  console.clear();
  console.log("=========================");
  cookie = await readLoginData();
  const { browser, page } = await spawnBrowser();
  await getNewStreamers(page);
  console.log("=========================");
  console.log("Running watcher...");
  await viewRandomPage(browser, page);
}

main();

process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);
