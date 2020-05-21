/* Updated version by AlexSimpler and PurpleMyst */                                                                                    

// @ts-check
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

// ========================================== CONFIG SECTION =================================================================
const CONFIG_PATH = "./config.json";
const SCREENSHOT_FOLDER = "screenshots";
const BASE_URL = "https://www.twitch.tv";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36";

const STREAMERS_URL = `${BASE_URL}/directory/game/`;

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
const DROP_INVENTORY_LIST = 'div.tw-flex-wrap.tw-tower.tw-tower--180.tw-tower--gutter-sm';
const DROP_ITEM = '.tw-flex';
const CATEGORY_NOT_FOUND = '[data-a-target="core-error-message"]';
const DROP_STATUS = '[data-a-target="Drops Enabled"]';

// ========================================== CONFIG SECTION =================================================================

// ========================================== UTILS SECTION =================================================================
/**
* @param {Object} page
* @param {String} query the query
* @author AlexSimpler
* @return 
*/
async function query(page, query) {
  let bodyHTML = await page.evaluate(() => document.body.innerHTML);
  //use cheerio server based jquery
  //load the whole body for cheerio to operate with
  let $ = cheerio.load(bodyHTML);
  //defining a var for the selection
  const jquery = $(query);
  //returning it with some checks
  if (!jquery)
    throw new Error("Invalid query result");
  return jquery;
}

/**
* @param {Number} ms number of milliseconds to wait until the program resumes execution 
* @author AlexSimpler
* @return {Promise} an anonymous promise which resolves after a timeout
*/
function idle(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
* @param word makes the first letter of the word uppercase
* @author AlexSimpler
* @return the modified word
*/
function capitalize(word) {
  return (word[0].toUpperCase() + word.substring(1));
}

/**
* @param {Object} page name takes as parameters the page handler aswell as the name of the property inside twilight-user
* @param {String} name The cookie title
* @author AlexSimpler
* @return {Promise<String>} the value of the cookie
*/
async function getUserProperty(page, name) {

  if (!name || !(/^[A-Za-z1-9]+$/.test(name))) throw new Error("Invalid cookie name: ", name);

  const data = await page.cookies();
  let cookieValue = undefined;

  for (let i = 0; i < data.length; i++) {
    if (data[i].name == 'twilight-user') {
      cookieValue = JSON.stringify((data[i].value).replace(/\%+[1-9]+/gm, ' ').replace(/\ \C\ /gm, ""));
      cookieValue = cookieValue.replace(/"+/gm, "");
      let reg = new RegExp(`(?<=${name}\\s\\:\\s)[a-zA-Z0-9]+`, 'gm');
      cookieValue = cookieValue.match(reg);
    }
  }
  if(!cookieValue[0])
    throw new Error("Invalid cookie value");
  return cookieValue[0];
}
// ========================================== UTILS SECTION =================================================================

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
 * @param {String} game the game name
 * @returns {Promise<boolean>} Are there any drops?
 */
async function hasDrops(browser, game) {
  header("Dropcheck");
  debug("Opening inventory page ...");
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/inventory`, { waitUntil: "networkidle2" });
  debug("Querying for drops ...");
  
  /* Updated by AlexSimpler */
  let noDrops = await query(page, NO_DROPS_QUERY);
  let received = false;
  //if there are noDrops then length > 0
  if (noDrops.length === 0) {
    info("Haven't received a drop yet");
  }
  else {
    //wait for some time before querying to avoid some element not found errors
    await idle(1000);
    
    let count = 0;
    let drop = await query(page, DROP_INVENTORY_LIST);
    count = (await query(page, DROP_INVENTORY_LIST + ">" + DROP_ITEM)).length;

    if (count) {
      //just itterate through each notification and break if one drop has the name of the game name uppercase
      for (let i = 0; i < count; i++) {
        let game = (await query(page, `${DROP_INVENTORY_LIST + ">" + DROP_ITEM}:nth-child(${i + 1}) ${DROP_INVENTORY_NAME}`))
          .text().toUpperCase();
        if (game == game.toUpperCase()) {
          received = true;
          break;
        }
      }
      await idle(1500);
      if (received) {
        success(`Congrats you got ${(capitalize(game))}!`);
      }
      else {
       info("Haven't received a drop yet");
      }
    }
  }  
  await page.close();
  return received;
}

/**
 * @description Exit the program if we already have the Valorant drop
 * @param {puppeteer.Browser} browser
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
async function watchRandomStreamers(browser, page, streamUrl, game) {
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
      await getNewStreamers(page, streamUrl);
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
    const channelStatus = (await query(page, CHANNEL_STATUS_QUERY)).text().trim().toUpperCase();
    info("Channel status: " + channelStatus);
    // We use `startsWith` because sometimes we get LIVELIVE
    // Also `toUpperCase` because sometimes we get LiveLIVE
    // This is because there are two elements with that class name
    // One below the player and one "in" the player
    if (!channelStatus.includes("LIVE")) {
      error("Streamer is offline");
      await page.waitFor(jitter(1000));
      continue;
    }

    // Does the streamer have drops enabled?
    //Updated by AlexSimpler
    const dropsEnabled = (await query(page, DROP_STATUS)).text();
    
    if (!dropsEnabled) {
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
    info(`Watching stream for ${watchminutes} minutes. ETA: ${dayjs().add((watchminutes), 'minutes').format('HH:mm:ss')}`);

    await page.waitFor(watchmillis);
  }

  error("We should never get here.");
}

/**
 * @description Read the config to get token and browser executable path
 * @returns {Promise<{exec: string, token: string}>}
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
  return JSON.parse(await fs.readFile(CONFIG_PATH, "utf-8"));
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
 */
async function getNewStreamers(page, streamUrl) {
  header("Streamer Refresh");
  await page.goto(streamUrl, { waitUntil: "networkidle0" });
  
  //was the category found?
  const notFound = await query(page, CATEGORY_NOT_FOUND);

  if (notFound.length || notFound.text() == "Category does not exist") {
     error(`Game category not found, did you enter the game as displayed on twitch?`);
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
     //get the name cookie - updated by AlexSimpler
     const name = await getUserProperty(page, 'displayName');
     success(`Successfully logged in as ${name}!`);
  } else {
    error("Login failed, is your token valid?.");
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

async function main(url) {
  //added game - AlexSimpler
  const { exec, token, game} = await readConfig();
  browserConfig.executablePath = exec;
  authTokenCookie.value = token;
  let streamUrl = (url + game.toUpperCase());
  
  const { browser, page } = await openBrowser();
  await getNewStreamers(page, streamUrl, game);
  await watchRandomStreamers(browser, page, streamUrl, game);
}

async function shutdown() {
  info("See ya!");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main(STREAMERS_URL);
