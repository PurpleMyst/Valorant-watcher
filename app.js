// @ts-check
// Updated version by AlexSimpler and PurpleMyst

const puppeteer = require("puppeteer-core");
const dayjs = require("dayjs");
const fs = require("fs").promises;
const treekill = require("tree-kill");
const path = require("path");
const chalk = require("chalk");

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

const CONFIG_PATH = "config.json";
const SCREENSHOT_FOLDER = "screenshots";
const BASE_URL = "https://www.twitch.tv";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36";

const STREAMERS_URL = `${BASE_URL}/directory/game`;

const SCROLL_DELAY = 2000;
const SCROLL_REPETITIONS = 5;

const MIN_WATCH_MINUTES = 15;
const MAX_WATCH_MINUTES = 30;

const REFRESH_INTERVAL = 1;
const BROWSER_RESTART_INTERVAL = 1;
const TIME_UNIT = "hour";

const SHOW_BROWSER = false;
const TAKE_SCREENSHOTS = true;

const HEADER_WIDTH = 40;

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
const DROP_INVENTORY_NAME = '[data-test-selector="drops-list__game-name"]';
const DROP_INVENTORY_LIST =
  "div.tw-flex-wrap.tw-tower.tw-tower--180.tw-tower--gutter-sm";
const CATEGORY_NOT_FOUND = '[data-a-target="core-error-message"]';
const DROP_STATUS = '[data-a-target="Drops Enabled"]';

/**
 * @param {string} word makes the first letter of the word uppercase
 * @author AlexSimpler
 * @return the modified word
 */
function capitalize(word) {
  return word[0].toUpperCase() + word.substring(1);
}

/**
 * @param {puppeteer.Page} page
 * @param {string} name The property name
 * @author AlexSimpler
 * @return {Promise<string | undefined>} The value of the property in twilight-user if present
 */
async function getUserProperty(page, name) {
  const cookies = await page.cookies();
  const cookie = cookies.find((cookie) => cookie.name == "twilight-user");
  if (cookie === undefined) throw new Error("No twilight-user cookie");
  const twilightUser = JSON.parse(decodeURIComponent(cookie.value));
  return twilightUser[name];
}

/**
 * @description Output an informational message
 * @param {string} message
 */
function info(message) {
  console.info(`[${chalk.blue("i")}] ${message}`);
}

/**
 * @description Indicate that something succeeded
 * @param {string} message
 */
function success(message) {
  console.info(`[${chalk.green("✓")}] ${message}`);
}

/**
 * @description Output something useful only for debugging
 * @param {string} message
 */
function debug(message) {
  console.debug(`[${chalk.yellow("d")}] ${message}`);
}

/**
 * @description Indicate that something failed
 * @param {string} message
 */
function error(message) {
  console.error(`[${chalk.red("✗")}] ${message}`);
}

/**
 * @description Make a big separator header
 * @param {string} message
 */
function header(message) {
  const space_around = (HEADER_WIDTH - message.length) / 2;
  const equals = "=".repeat(space_around - 2);
  console.log();
  console.log(`${equals}[ ${chalk.cyan(message)} ]${equals}`);
}

/**
 * @description Check if there are _any_ drops in the inventory page
 * @param {puppeteer.Browser} browser
 * @param {string} game the game name
 * @returns {Promise<boolean>} Are there any drops?
 */
async function hasDrops(browser, game) {
  header("Dropcheck");
  debug("Opening inventory page ...");
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/inventory`, { waitUntil: "networkidle2" });
  debug("Querying for drops ...");

  // Check if the "no drops" element is present
  const noDrops = await page.$(NO_DROPS_QUERY);
  if (noDrops !== null) {
    error("No drops yet");
    await page.close();
    return false;
  }

  // If not, wait for the drop inventory list to appear
  debug("Waiting for inventory list ...");
  await page.waitForSelector(DROP_INVENTORY_LIST);

  // Then iterate over all the drops and see if we've got one matching our chosen one
  const drops = await page.$$eval(DROP_INVENTORY_NAME, (drops) =>
    drops.map((drop) => drop.textContent.toUpperCase())
  );
  await page.close();

  if (drops.find((drop) => drop === game) !== undefined) {
    success(`${capitalize(game)} has dropped!`);
    return true;
  } else {
    error("No drops yet");
    return false;
  }
}

/**
 * @description Exit the program if we already have the game
 * @param {puppeteer.Browser} browser
 * @param {string} game
 */
async function checkDrops(browser, game) {
  if (await hasDrops(browser, game)) {
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
async function watchRandomStreamers(browser, page, game) {
  let nextStreamerRefresh = dayjs().add(REFRESH_INTERVAL, TIME_UNIT);
  let nextBrowserRestart = dayjs().add(BROWSER_RESTART_INTERVAL, TIME_UNIT);

  // Let's check before starting if we got the game drop
  await checkDrops(browser, game);

  while (run) {
    // Are we due for a cleaning?
    if (dayjs(nextBrowserRestart).isBefore(dayjs())) {
      info("Restarting the browser ...");

      // Before leaving, let's check if we got the game
      await checkDrops(browser, game);

      const newBrowser = await restartBrowser(browser);
      browser = newBrowser.browser;
      page = newBrowser.page;
      nextBrowserRestart = dayjs().add(BROWSER_RESTART_INTERVAL, TIME_UNIT);
    }

    // Are we due for a streamer refresh?
    if (dayjs(nextStreamerRefresh).isBefore(dayjs())) {
      await getNewStreamers(page, game);
      nextStreamerRefresh = dayjs().add(REFRESH_INTERVAL, TIME_UNIT);
    }

    // Choose a random streamer and watchtime
    const streamer = streamers[getRandomInt(0, streamers.length - 1)];
    const watchminutes = getRandomInt(MIN_WATCH_MINUTES, MAX_WATCH_MINUTES);
    const watchmillis = watchminutes * 60 * 1000;

    // Watch chosen streamer
    header(streamer);
    info(`Now watching: ${BASE_URL}/${streamer}`);
    await page.goto(`${BASE_URL}/${streamer}`, { waitUntil: "networkidle0" });

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
      error("Playback error: " + errorMatch[1]);
      await page.waitFor(jitter(1000));
      continue;
    }

    // Is this streamer still streaming?
    // We use `startsWith` because sometimes we get LIVELIVE
    // Also `toUpperCase` because sometimes we get LiveLIVE
    // This is because there are two elements with that class name
    // One below the player and one "in" the player
    const channelStatus = await page
      .$eval(CHANNEL_STATUS_QUERY, (el) => el.textContent.trim().toUpperCase())
      .catch(() => "Unknown");
    info("Channel status: " + channelStatus);
    if (!channelStatus.includes("LIVE")) {
      error("Streamer is offline");
      await page.waitFor(jitter(1000));
      continue;
    }

    // Does the streamer have drops enabled?
    // Updated by AlexSimpler
    const dropsEnabled = await page.$(DROP_STATUS);
    if (dropsEnabled === null) {
      error("Streamer doesn't have drops enabled");
      await page.waitFor(jitter(1000));
      continue;
    } else {
      info("Streamer has drops enabled");
    }

    // Always set the lowest possible resolution
    // It's inconsistent between streamers
    debug("Setting lowest possible resolution ...");
    await clickIfPresent(page, STREAM_PAUSE_QUERY);

    await clickIfPresent(page, STREAM_SETTINGS_QUERY);

    await page.waitForSelector(STREAM_QUALITY_SETTING_QUERY);
    await clickIfPresent(page, STREAM_QUALITY_SETTING_QUERY);

    await page.click(STREAM_WORST_QUALITY_QUERY);

    await clickIfPresent(page, STREAM_PAUSE_QUERY);

    if (TAKE_SCREENSHOTS) {
      await page.waitFor(jitter(1000));

      const screenshotName = `${streamer}.png`;
      const screenshotPath = path.join(SCREENSHOT_FOLDER, screenshotName);

      // Create the screenshot folder if it does not exist
      await fs
        .access(SCREENSHOT_FOLDER)
        .catch(() => fs.mkdir(SCREENSHOT_FOLDER));

      await page.screenshot({ path: screenshotPath });

      info(`Screenshot created: ${screenshotPath}`);
    }

    // Get account status from sidebar
    await clickIfPresent(page, SIDEBAR_QUERY);
    const status = await page
      .$eval(USER_STATUS_QUERY, (el) => el.textContent)
      .catch(() => "Unknown");
    await clickIfPresent(page, SIDEBAR_QUERY);

    info(`Account status: ${status}`);
    info(`Time: ${dayjs().format("HH:mm:ss")}`);
    info(
      `Watching stream for ${watchminutes} minutes. ETA: ${dayjs()
        .add(watchminutes, "minute")
        .format("HH:mm:ss")}`
    );

    await page.waitFor(watchmillis);
  }

  error("We should never get here.");
}

/**
 * @description Read the config to get token and browser executable path
 * @returns {Promise<{exec: string, token: string, game: string}>}
 */
async function readConfig() {
  header("Config");

  try {
    await fs.access(CONFIG_PATH);
  } catch (e) {
    error("No config file found!");
    process.exit(1);
  }

  success("JSON config found!");
  const config = JSON.parse(await fs.readFile(CONFIG_PATH, "utf-8"));

  if (!("exec" in config && "token" in config && "game" in config)) {
    error("JSON config invalid, did you define `exec`, `token`, and `game`?");
    process.exit(1);
  }

  config.game = config.game.toUpperCase();
  return config;
}

/**
 * @description Launch a new browser instance
 * @returns {Promise<{browser: puppeteer.Browser, page: puppeteer.Page}>}
 */
async function openBrowser() {
  header("Startup");
  const browser = await puppeteer.launch(browserConfig);
  const page = await browser.newPage();

  debug("Setting User-Agent ...");
  await page.setUserAgent(USER_AGENT);

  debug("Setting auth token ...");
  await page.setCookie(authTokenCookie);

  debug("Setting timeouts to zero ...");
  page.setDefaultNavigationTimeout(0);
  page.setDefaultTimeout(0);

  success("Browser started!");

  return { browser, page };
}

/**
 * @description Refresh the list of streamers
 * @param {puppeteer.Page} page
 * @param {string} game
 */
async function getNewStreamers(page, game) {
  header("Streamer Refresh");
  await page.goto(`${STREAMERS_URL}/${game}`, { waitUntil: "networkidle0" });

  const notFound = await page.$(CATEGORY_NOT_FOUND);
  if (notFound !== null) {
    error(
      "Game category not found, did you enter the game as displayed on twitch?"
    );
    await shutdown();
  }

  debug("Checking login ...");
  await checkLogin(page);

  debug("Scrolling a bit ...");
  await scroll(page);

  const newStreamers = await page.$$eval(CHANNELS_QUERY, (streamerLinks) =>
    streamerLinks.map((link) => link.getAttribute("href").split("/")[1])
  );
  streamers.splice(0, streamers.length, ...newStreamers);

  success(`Got ${streamers.length} new streamers`);
}

/**
 * @description Validate the auth token given
 * @param {puppeteer.Page} page
 */
async function checkLogin(page) {
  const cookies = await page.cookies();
  if (cookies.findIndex((cookie) => cookie.name === "twilight-user") !== -1) {
    // Get the name property (updated by AlexSimpler)
    const name = await getUserProperty(page, "displayName");
    success(`Successfully logged in as ${chalk.greenBright(name)}!`);
  } else {
    error("Login failed, is your token valid?");
    process.exit();
  }
}

/**
 * @description Scroll to an amount of scrollable triggers
 * @param {puppeteer.Page} page
 */
async function scroll(page) {
  info(
    `Scrolling to ${SCROLL_REPETITIONS} scrollable triggers (ETA ${
      (SCROLL_REPETITIONS * SCROLL_DELAY) / 1000
    } seconds) ...`
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
    debug(`No element matching '${queryString}' to click`);
  }
  await page.waitFor(jitter(500));
}

/**
 * @description Restart the current browser
 * @param {puppeteer.Browser} browser
 */
async function restartBrowser(browser) {
  const pages = await browser.pages();
  /** @param {puppeteer.Page} page */
  await Promise.all(pages.map((page) => page.close()));
  treekill(browser.process().pid, "SIGKILL");
  return await openBrowser();
}

async function main() {
  // added game - AlexSimpler
  const { exec, token, game } = await readConfig();
  browserConfig.executablePath = exec;
  authTokenCookie.value = token;

  const { browser, page } = await openBrowser();
  await getNewStreamers(page, game);
  await watchRandomStreamers(browser, page, game);
}

async function shutdown() {
  info("See ya!");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main();
