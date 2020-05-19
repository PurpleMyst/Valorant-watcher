// @ts-check

const puppeteer = require("puppeteer-core");
const dayjs = require("dayjs");
const fs = require("fs");
const treekill = require("tree-kill");
const path = require("path");

/** @type puppeteer.SetCookie */
const authTokenCookie = {
  name: "auth-token",
  value: "",

  domain: ".twitch.tv",
  httpOnly: false,
  path: "/",
  sameSite: "Lax",
  secure: true,
  session: false,
};

let run = true;

/** @type {string[]} */
const streamers = [];

// ========================================== CONFIG SECTION =================================================================
const CONFIG_PATH = "config.json";
const SCREENSHOT_FOLDER = "screenshots";
const BASE_URL = "https://www.twitch.tv/";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36";

const STREAMERS_URL =
  "https://www.twitch.tv/directory/game/VALORANT?tl=c2542d6d-cd10-4532-919b-3d19f30a768b";

const SCROLL_DELAY = 2000;
const SCROLL_REPETITIONS = 5;

const MIN_WATCH_MINUTES = 15;
const MAX_WATCH_MINUTES = 30;

const REFRESH_INTERVAL = 1;
const BROWSER_RESTART_INTERVAL = 1;
const TIME_UNIT = "hour";

const SHOW_BROWSER = true;
const TAKE_SCREENSHOTS = true;

const browserConfig = {
  headless: !SHOW_BROWSER,
  args: [
    "--mute-audio",
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
const STREAM_WORST_QUALITY_QUERY =
  '[data-a-target="player-settings-menu"] .tw-pd-05:last-child .tw-radio';
const CHANNEL_STATUS_QUERY = ".tw-channel-status-text-indicator";
const NO_DROPS_QUERY = 'div[data-test-selector="drops-list__no-drops-default"]';

// ========================================== CONFIG SECTION =================================================================

/**
 * @description Check if there are _any_ drops in the inventory page
 * @param {puppeteer.Browser} browser
 * @returns {Promise<boolean>} Are there any drops?
 */
async function hasValorantDrop(browser) {
  console.debug("Opening inventory page...");
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}inventory`, { waitUntil: "networkidle2" });
  console.debug("Querying for drops ...");
  const noDropsElement = await page.$(NO_DROPS_QUERY);
  const noDrops = noDropsElement === null;
  await page.close();
  console.info(
    noDrops
      ? "Seems like we have a drop!"
      : "Doesn't look like we got anything :("
  );
  return noDrops;
}

/**
 * @description Exit the program if we already have the Valorant drop
 * @param {puppeteer.Browser} browser
 */
async function checkValorantDrop(browser) {
  if (await hasValorantDrop(browser)) {
    await shutdown();
  }
}

/**
 * @description Return a random integer in a given range
 * @param {number} min The minimum number to get, inclusive
 * @param {number} max The maximum number to get, inclusive
 * @returns {number} A random number
 */
function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * @param {number} num The number to jitter
 * @returns {number} The number jittered by 10%
 */
function jitter(num) {
  return num + getRandomInt(-num / 10, num / 10);
}

/**
 * @description Start watching random streamers
 * @param {puppeteer.Browser} browser The current browser instance
 * @param {puppeteer.Page} page The twitch.tv streamer page
 */
async function watchRandomStreamers(browser, page) {
  let nextStreamerRefresh = dayjs().add(REFRESH_INTERVAL, TIME_UNIT);
  let nextBrowserRestart = dayjs().add(BROWSER_RESTART_INTERVAL, TIME_UNIT);

  // Let's check before starting if we got valorant
  await checkValorantDrop(browser);

  while (run) {
    // Are we due for a cleaning?
    if (dayjs(nextBrowserRestart).isBefore(dayjs())) {
      console.debug("Restarting the browser ...");

      // Before leaving, let's check if we got valorant
      await checkValorantDrop(browser);

      const newBrowser = await restartBrowser(browser);
      browser = newBrowser.browser;
      page = newBrowser.page;
      nextBrowserRestart = dayjs().add(BROWSER_RESTART_INTERVAL, TIME_UNIT);
    }

    // Are we due for a streamer refresh?
    if (dayjs(nextStreamerRefresh).isBefore(dayjs())) {
      await getNewStreamers(page);
      nextStreamerRefresh = dayjs().add(REFRESH_INTERVAL, TIME_UNIT);
    }

    // Choose a random streamer and watchtime
    const chosenStreamer = streamers[getRandomInt(0, streamers.length - 1)];
    const watchminutes = getRandomInt(MIN_WATCH_MINUTES, MAX_WATCH_MINUTES);
    const watchmillis = watchminutes * 60 * 1000;

    // Watch chosen streamer
    console.info();
    console.info(`Now watching streamer: ${BASE_URL}${chosenStreamer}`);
    await page.goto(BASE_URL + chosenStreamer, { waitUntil: "networkidle0" });

    // Remove annoying popups
    await clickIfPresent(page, COOKIE_POLICY_QUERY);
    await clickIfPresent(page, MATURE_CONTENT_QUERY);

    // Check for content gate overlay
    const contentGate = await page
      .$eval(
        '[data-a-target="player-overlay-content-gate"]',
        (gate) => gate.textContent
      )
      .catch(() => "");
    const errorMatch = contentGate.match(/Error #(\d{4})/);
    if (errorMatch !== null) {
      console.error("We got a playback error: " + errorMatch[1]);
      await page.waitFor(jitter(1000));
      continue;
    }

    // Is this streamer still streaming?
    const channelStatus = await page
      .$eval(CHANNEL_STATUS_QUERY, (el) => el.textContent)
      .catch(() => "");
    console.info("Channel status: " + channelStatus);
    // We use `startsWith` because sometimes we get LIVELIVE
    // Also `toUpperCase` because sometimes we get LiveLIVE
    // This is because there are two elements with that class name
    // One below the player and one "in" the player
    if (!channelStatus.toUpperCase().startsWith("LIVE")) {
      console.info("Nevermind, they're not streaming ...");
      await page.waitFor(jitter(1000));
      continue;
    }

    // Does the streamer have drops enabled?
    const dropsEnabled = await page
      .$eval('[data-a-target="Drops Enabled"]', () => true)
      .catch(() => false);
    if (!dropsEnabled) {
      console.info("Streamer DOES NOT have drops enabled");
      await page.waitFor(jitter(1000));
      continue;
    } else {
      console.info("Streamer has drops enabled");
    }

    // Always set the lowest possible resolution
    // It's inconsistent between streamers
    console.info("Setting lowest possible resolution...");
    await clickIfPresent(page, STREAM_PAUSE_QUERY);

    await clickIfPresent(page, STREAM_SETTINGS_QUERY);

    await page.waitForSelector(STREAM_QUALITY_SETTING_QUERY);
    await clickIfPresent(page, STREAM_QUALITY_SETTING_QUERY);

    await page.click(STREAM_WORST_QUALITY_QUERY);

    await clickIfPresent(page, STREAM_PAUSE_QUERY);

    if (TAKE_SCREENSHOTS) {
      await page.waitFor(jitter(1000));

      const screenshotName = `${chosenStreamer}.png`;
      const screenshotPath = path.join(SCREENSHOT_FOLDER, screenshotName);

      if (!fs.existsSync(SCREENSHOT_FOLDER)) fs.mkdirSync(SCREENSHOT_FOLDER);
      await page.screenshot({ path: screenshotPath });

      console.info(`Screenshot created: ${screenshotPath}`);
    }

    // Get account status from sidebar
    await clickIfPresent(page, SIDEBAR_QUERY);
    const status = await page
      .$eval(USER_STATUS_QUERY, (el) => el.textContent)
      .catch(() => "Unknown");
    await clickIfPresent(page, SIDEBAR_QUERY);

    console.info(`Account status: ${status}`);
    console.info(`Time: ${dayjs().format("HH:mm:ss")}`);
    console.info(`Watching stream for ${watchminutes} minutes`);
    console.info();

    await page.waitFor(watchmillis);
  }

  console.error("We should never get here.");
}

/**
 * @description Read the config to get token and browser executable path
 * @returns {Promise<{exec: string, token: string}>}
 */
async function readConfig() {
  console.log("Checking config file...");

  if (fs.existsSync(CONFIG_PATH)) {
    console.log("JSON config found!");
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } else {
    console.log("No config file found!");
    process.exit(1);
  }
}

/**
 * @description Launch a new browser instance
 * @returns {Promise<{browser: puppeteer.Browser, page: puppeteer.Page}>}
 */
async function openBrowser() {
  console.log("=========================");
  console.log("Launching browser...");
  const browser = await puppeteer.launch(browserConfig);
  const page = await browser.newPage();

  console.log("Setting User-Agent...");
  await page.setUserAgent(USER_AGENT);

  console.log("Setting auth token...");
  await page.setCookie(authTokenCookie);

  console.log("Setting timeouts to zero...");
  page.setDefaultNavigationTimeout(0);
  page.setDefaultTimeout(0);

  return { browser, page };
}

/**
 * @description Refresh the list of streamers
 * @param {puppeteer.Page} page
 */
async function getNewStreamers(page) {
  console.log("=========================");
  await page.goto(STREAMERS_URL, { waitUntil: "networkidle0" });

  console.info("Checking login...");
  await checkLogin(page);

  console.info("Checking active streamers...");
  await scroll(page);

  const newStreamers = await page.$$eval(CHANNELS_QUERY, (streamerLinks) =>
    streamerLinks.map((link) => link.getAttribute("href").split("/")[1])
  );
  streamers.splice(0, streamers.length, ...newStreamers);
}

/**
 * @description Validate the auth token given
 * @param {puppeteer.Page} page
 */
async function checkLogin(page) {
  const cookies = await page.cookies();
  if (cookies.findIndex((cookie) => cookie.name === "twilight-user") !== -1) {
    console.info("Login successful!");
  } else {
    console.error("Invalid token.");
    process.exit();
  }
}

/**
 * @description Scroll to an amount of scrollable triggers
 * @param {puppeteer.Page} page
 */
async function scroll(page) {
  console.info(
    `Scrolling to ${SCROLL_REPETITIONS} scrollable triggers (ETA ${
      (SCROLL_REPETITIONS * SCROLL_DELAY) / 1000
    } seconds)...`
  );

  for (let i = 0; i < SCROLL_REPETITIONS; ++i) {
    await page.evaluate(async () => {
      document
        .getElementsByClassName("scrollable-trigger__wrapper")[0]
        .scrollIntoView();
    });
    await page.waitFor(jitter(SCROLL_DELAY));
  }
}

/**
 * @description Click an element by its query selector if it is present in the page
 * @param {puppeteer.Page} page
 * @param {String} queryString
 */
async function clickIfPresent(page, queryString) {
  try {
    await page.click(queryString);
  } catch (e) {
    console.warn(`Failed to click ${queryString}`);
  }
  await page.waitFor(jitter(500));
}

/**
 * @description Restart the current browser
 * @param {puppeteer.Browser} browser
 */
async function restartBrowser(browser) {
  const pages = await browser.pages();
  /**
   * @param {puppeteer.Page} page
   */
  await Promise.all(pages.map((page) => page.close()));
  treekill(browser.process().pid, "SIGKILL");
  return await openBrowser();
}

async function main() {
  console.clear();
  console.log("=========================");

  const { exec, token } = await readConfig();
  browserConfig.executablePath = exec;
  authTokenCookie.value = token;

  const { browser, page } = await openBrowser();
  await getNewStreamers(page);
  console.log("=========================");
  console.log("Watching random streamers...");
  await watchRandomStreamers(browser, page);
}

async function shutdown() {
  console.log();
  console.log("See ya!");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main();
