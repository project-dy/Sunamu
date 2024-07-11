import { app, BrowserWindow, ipcMain, Menu, MenuItem, shell, Tray } from "electron";
import { resolve } from "path";
import getPlayer, { Player } from "./player";
import configEmitter, { getAll as getAllConfig } from "./config";
import { widgetModeElectron, debugMode, devTools } from "./appStatus";
import windowStateKeeper from "electron-window-state";
import playbackStatus, { setCustomLyrics, songdata } from "./playbackStatus";
import { getThemeLocation } from "./themes";
import { setTrackLogActive, trackLogActive, trackLogPath } from "./integrations/tracklogger";
import { discordPresenceConfig, updatePresence } from "./integrations/discordrpc";
import { getAllLyrics } from "./integrations/lyrics";

const openedBrowserWindows: Map<BrowserWindow, string> = new Map();
let trayIcon: Tray | undefined;
let player: Player;

// Enable GPU rasterization so it's smooth asf
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("ozone-platform-hint", "auto");

function getIcon() {
	let icoName = "512x512.png";
	return resolve(__dirname, "..", "..", "assets", "icons", icoName);
}

function registerIpc() {
	ipcMain.on("previous", () => player.Previous());
	ipcMain.on("playPause", () => player.PlayPause());
	ipcMain.on("next", () => player.Next());

	ipcMain.on("shuffle", () => player.Shuffle());
	ipcMain.on("repeat", () => player.Repeat());

	ipcMain.on("seek", (_e, perc) => player.SeekPercentage(perc));
	ipcMain.handle("getPosition", async () => await player.GetPosition());
	ipcMain.on("setPosition", (_e, position) => player.SetPosition(position));

	ipcMain.handle("getSongData", () => songdata);
	ipcMain.handle("getConfig", () => getAllConfig());

	ipcMain.handle("searchAllLyrics", async (_e, metadata) => await getAllLyrics(metadata));
	ipcMain.on("chooseLyrics", async (_e, lyrics) => await setCustomLyrics(lyrics));

	ipcMain.handle("isWidgetMode", (e) => {
		const _win = BrowserWindow.fromWebContents(e.sender);

		if(!_win)
			return false; // without browserwindow we return false, always

		const scene = openedBrowserWindows.get(_win);
		if(scene)
			return isWidgetModeForScene(scene);

		return false;
	});

	ipcMain.handle("isDebugMode", () => debugMode);

	ipcMain.handle("getScene", (e) => {
		const _win = BrowserWindow.fromWebContents(e.sender);
		if(_win)
			return openedBrowserWindows.get(_win);
		return undefined;
	});

	ipcMain.handle("getThemeLocationFor", (_e, theme) => getThemeLocation(theme));

	ipcMain.on("minimize", (e) => {
		const _win = BrowserWindow.fromWebContents(e.sender);
		if(_win) _win.minimize();
	});

	ipcMain.on("close", (e) => {
		const _win = BrowserWindow.fromWebContents(e.sender);
		if (_win) _win.close();
		
		if(!BrowserWindow.getAllWindows().length)
			app.exit();
	});

	ipcMain.on("openExternal", (_e, uri) => shell.openExternal(uri));
}

function isWidgetModeForScene(scene: string){
	if (!scene || scene === "electron")
		return widgetModeElectron; // assume default scene if scene is not there

	return getAllConfig().scenes[scene].widgetMode;
}

function willSceneShowLyrics(scene: string){
	if (typeof getAllConfig().scenes[scene].showLyrics !== "undefined")
		return getAllConfig().scenes[scene].showLyrics;

	return true;
}

function registerWindowCallbacks(win: BrowserWindow){
	const positionCallback = async (position, reportsPosition) => { if(!win.webContents.isLoading()) return win.webContents.send("position", position, reportsPosition); };
	const songDataCallback = async (songdata, metadataChanged) => { if(!win.webContents.isLoading()) return win.webContents.send("update", songdata, metadataChanged); };
	const lyricsUpdateCallback = async () => { if(!win.webContents.isLoading()) return win.webContents.send("refreshLyrics"); };
	const configChangedCallback = async () => { if(!win.webContents.isLoading()) return win.webContents.send("configChanged"); };

	playbackStatus.on("position", positionCallback);
	playbackStatus.on("songdata", songDataCallback);
	playbackStatus.on("lyrics", lyricsUpdateCallback);

	configEmitter.on("configChanged", configChangedCallback);

	win.once("close", () => {
		playbackStatus.off("position", positionCallback);
		playbackStatus.off("songdata", songDataCallback);
		playbackStatus.off("lyrics", lyricsUpdateCallback);

		configEmitter.off("configChanged", configChangedCallback);
	});

	win.once("closed", () => {
		openedBrowserWindows.delete(win);
	});
}

async function spawnWindow(scene = "electron") {
	const windowState = windowStateKeeper({
		defaultWidth: 458,
		defaultHeight: 512,
		file: `window-state-${scene}.json`
	});

	const win = new BrowserWindow({
		show: false,
		frame: false,
		transparent: isWidgetModeForScene(scene),
		hasShadow: !isWidgetModeForScene(scene),
		x: windowState.x,
		y: windowState.y,
		width: windowState.width,
		height: windowState.height,
		minWidth: 458,
		minHeight: willSceneShowLyrics(scene) ? 512 : 424,
		maxHeight: willSceneShowLyrics(scene) ? undefined : 548,
		backgroundColor: isWidgetModeForScene(scene) ? "#00000000" : "#000000",
		maximizable: !isWidgetModeForScene(scene),
		minimizable: !isWidgetModeForScene(scene),
		resizable: true,
		fullscreenable: !isWidgetModeForScene(scene),
		skipTaskbar: isWidgetModeForScene(scene),
		focusable: true,
		autoHideMenuBar: true,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: resolve(__dirname, "..", "www", "lib", "npapi", "electron-npapi.js")
		},
		roundedCorners: true,
		icon: getIcon(),
		title: (isWidgetModeForScene(scene) ? "Sunamu Widget" : "Sunamu") + (scene !== "electron" ? `[${scene}]` : "")
	});
	windowState.manage(win);

	if (debugMode && devTools) win.webContents.openDevTools();

	win.loadFile(resolve(__dirname, "..", "www", "index.htm"));
	win.once("ready-to-show", async () => {
		win.show();
	});

	registerWindowCallbacks(win);
	return win;
}

function setupTrayIcon() {
	if(!trayIcon){
		trayIcon = new Tray(getIcon());
		trayIcon.setToolTip("Sunamu Widget");
		trayIcon.setTitle("Sunamu");
		const contextMenu = new Menu();

		// Discord RPC toggle
		contextMenu.append(new MenuItem({
			id: "discordRpcToggle",
			label: "Discord RPC",
			type: "checkbox",
			checked: discordPresenceConfig.enabled,
			click(item) {
				discordPresenceConfig.enabled = item.checked;
				updatePresence();
			}
		}));

		// Tracklog toggle
		contextMenu.append(new MenuItem({
			id: "tracklogToggle",
			label: "Log tracks to file",
			type: "checkbox",
			checked: trackLogActive,
			click(item) {
				setTrackLogActive(item.checked);
				const tracklogOpen = contextMenu.items.find(x => x.id === "tracklogOpen");
				if(tracklogOpen)
					tracklogOpen.visible = item.checked;
				trayIcon?.setContextMenu(contextMenu);
			}
		}));

		// Tracklog open
		contextMenu.append(new MenuItem({
			id: "tracklogOpen",
			label: "Open current track log",
			type: "normal",
			visible: trackLogActive,
			click() {
				return shell.openPath(trackLogPath);
			}
		}));

		// Quit
		contextMenu.append(new MenuItem({
			id: "quit",
			label: "Quit Sunamu",
			type: "normal",
			role: "quit",
			click() {
				return app.exit();
			},
		}));

		trayIcon.setContextMenu(contextMenu);
	}
}

export default async function electronMain() {
	player = await getPlayer();
	registerIpc();

	await app.whenReady();
	setupTrayIcon();
	for(const scene in getAllConfig().scenes){
		if (getAllConfig().scenes[scene].type === "electron")
			openedBrowserWindows.set(await spawnWindow(scene), scene);
	}
}
