import songdata from "../songdata.js";
import { secondsToTime } from "../util.js";

/** @type {import("../../../src/types").DiscordPresenceConfig} */
const config = await window.np.getDiscordPresenceConfig();

async function getPresence() {
	if (!songdata || !songdata.metadata.id || config.blacklist.includes(songdata.appName))
		return;

	const now = Date.now();
	const start = Math.round(now - (songdata.elapsed * 1000));
	const end = Math.round(start + (songdata.metadata.length * 1000));

	/** @type {import("discord-rpc").Presence} */
	const activity = {
		details: songdata.metadata.artist,
		state: `${songdata.metadata.title} (${secondsToTime(songdata.metadata.length)})`,
		largeImageKey: "app_large",
		largeImageText: songdata.metadata.album,
		smallImageKey: songdata.status.toLowerCase(),
		smallImageText: songdata.status,
		instance: false,
		buttons: []
	};

	if (songdata.status === "Playing") {
		activity.startTimestamp = start;
		activity.endTimestamp = end;
	}

	if (songdata.spotiUrl){
		activity.buttons.push({
			label: "Listen on Spotify",
			url: songdata.spotiUrl
		});
	}

	if (songdata.lastfm) {
		activity.buttons.push({
			label: "View on Last.fm",
			url: songdata.lastfm.url
		});
	}

	if(!activity.buttons.length)
		delete activity.buttons;

	return activity;
}

export async function updateDiscordPresence(){
	if(!config.enabled) return;

	return window.np.updateDiscordPresence(await getPresence());
}