// @ts-check
// Updated version by AlexSimpler and PurpleMyst

import puppeteer from "puppeteer-core";
import dayjs from "dayjs";
const fs = require("fs").promises;
import treekill from "tree-kill";
import path from "path";
import chalk from "chalk";

/** @type puppeteer.SetCookie */
const authTokenCookie: puppeteer.SetCookie = {
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

const streamers: string[] = [];

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

const browserConfig: puppeteer.LaunchOptions = {
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

/** @author AlexSimpler */
function capitalize(word: string) {
  return word[0].toUpperCase() + word.substring(1);
}

/** @author AlexSimpler */
async function getUserProperty(
  page: puppeteer.Page,
  name: string
): Promise<string | undefined> {
  const cookies = await page.cookies();
  const cookie = cookies.find((cookie) => cookie.name == "twilight-user");
  if (cookie === undefined) throw new Error("No twilight-user cookie");
  const twilightUser = JSON.parse(decodeURIComponent(cookie.value));
  return twilightUser[name];
}

function info(message: string) {
  console.info(`[${chalk.blue("i")}] ${message}`);
}

function success(message: string) {
  console.info(`[${chalk.green("✓")}] ${message}`);
}

function debug(message: string) {
  console.debug(`[${chalk.yellow("d")}] ${message}`);
}

function error(message: string) {
  console.error(`[${chalk.red("✗")}] ${message}`);
}

function header(message: string) {
  const space_around = (HEADER_WIDTH - message.length) / 2;
  const equals = "=".repeat(space_around - 2);
  console.log();
  console.log(`${equals}[ ${chalk.cyan(message)} ]${equals}`);
}

/** Check if a game has dropped */
async function hasDrops(
  browser: puppeteer.Browser,
  game: string
): Promise<boolean> {
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
    drops.map((drop) => drop.textContent?.toUpperCase() ?? "")
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

/** Exit the program if we already have the game */
async function checkDrops(browser: puppeteer.Browser, game: string) {
  if (await hasDrops(browser, game)) {
    await shutdown();
  }
}

/**
 * Get a random integer in a given range
 * @param min The minimum number to get, inclusive
 * @param max The maximum number to get, inclusive
 */
function getRandomInt(min: number, max: number): number {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Jitter a number by 10% */
function jitter(num: number): number {
  return num + getRandomInt(-num / 10, num / 10);
}

async function watchRandomStreamers(
  browser: puppeteer.Browser,
  page: puppeteer.Page,
  game: string
) {
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

    if (streamers.length === 0) {
      error("No streamers found!");
      await shutdown();
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
    const errorMatch = contentGate?.match(/Error #(\d{4})/);
    if (errorMatch != null) {
      error("Playback error: " + errorMatch[1]);
      await page.waitFor(jitter(1000));
      continue;
    }

    // Is this streamer still streaming?
    // We use `String.prototype.toUpperCase` because I've gotten "Live" instead of "LIVE" before
    const channelStatus = await page
      .$eval(CHANNEL_STATUS_QUERY, (el) => el.textContent?.trim().toUpperCase())
      .catch(() => "Unknown");
    info("Channel status: " + channelStatus);
    if (!channelStatus?.includes("LIVE")) {
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
async function readConfig(): Promise<{
  exec: string;
  token: string;
  game: string;
}> {
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
async function openBrowser(): Promise<{
  browser: puppeteer.Browser;
  page: puppeteer.Page;
}> {
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

async function getNewStreamers(page: puppeteer.Page, game: string) {
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
    streamerLinks
      .map((link) => link?.getAttribute("href")?.split("/")?.[1] ?? "")
      .filter((link) => link.length !== 0)
  );
  streamers.splice(0, streamers.length, ...newStreamers);

  success(`Got ${streamers.length} new streamers`);
}

async function checkLogin(page: puppeteer.Page) {
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

async function scroll(page: puppeteer.Page) {
  info(
    `Scrolling to ${SCROLL_REPETITIONS} scrollable triggers (ETA ${
      (SCROLL_REPETITIONS * SCROLL_DELAY) / 1000
    } seconds) ...`
  );

  for (let i = 0; i < SCROLL_REPETITIONS; ++i) {
    await page.evaluate(async () => {
      document
        .getElementsByClassName("scrollable-trigger__wrapper")[0]
        ?.scrollIntoView();
    });
    await page.waitFor(jitter(SCROLL_DELAY));
  }
}

async function clickIfPresent(page: puppeteer.Page, queryString: string) {
  try {
    await page.click(queryString);
  } catch (e) {
    debug(`No element matching '${queryString}' to click`);
  }
  await page.waitFor(jitter(500));
}

async function restartBrowser(browser: puppeteer.Browser) {
  const pages = await browser.pages();
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
