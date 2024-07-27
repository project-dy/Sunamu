import { debug } from "../";
import { ArtData, Metadata, Update } from "../../types";
import { readFile } from "fs/promises";
import mime from "mime";
import axios from "axios";
import Vibrant from "node-vibrant";
import { GetPosition as GetPositionSharePort } from "./mprisShairportSync";
import { ShairportSyncConfig } from "../../types";
import { get as getConfig } from "../config";

// @ts-ignore
import dbus from "dbus-next";
// @ts-ignore
import { getPlayer, getPlayerNames } from "mpris-for-dummies";
// @ts-ignore
import MediaPlayer2 from "mpris-for-dummies/lib/MediaPlayer2";
import sharp from "sharp";

let players: { [key: string]: MediaPlayer2 } = {};
let _denylist: string[] | undefined;
let activePlayer: string | undefined;
let updateCallback: Function;

const shairportSyncConfig: ShairportSyncConfig =
	getConfig<ShairportSyncConfig>("shairPortSync");

export async function init(
	callback: Function,
	denylist?: string[],
): Promise<void> {
	_denylist = denylist;
	updateCallback = callback;
	const proxy = await dbus
		.sessionBus()
		.getProxyObject("org.freedesktop.DBus", "/org/freedesktop/DBus");
	const iface = proxy.getInterface("org.freedesktop.DBus");

	iface.on("NameOwnerChanged", async (name, oldOwner, newOwner) => {
		if (name.match(/org\.mpris\.MediaPlayer2/) !== null) {
			if (oldOwner === "" && !_denylist?.includes(name)) await addPlayer(name);
			else if (newOwner === "" && Object.keys(players).includes(name))
				await deletePlayer(name);
		}
	});

	const names = await getPlayerNames();
	for (let name of names) if (!denylist?.includes(name)) await addPlayer(name);
}

export async function getUpdate(): Promise<Update | null> {
	if (!activePlayer) return null;

	try {
		let update: Update = {
			provider: "MPRIS2",
			metadata: await parseMetadata(players[activePlayer].Player.Metadata),
			capabilities: {
				canControl: players[activePlayer].Player.CanControl || false,
				canPlayPause:
					players[activePlayer].Player.CanPause ||
					players[activePlayer].Player.CanPlay ||
					false,
				canGoNext: players[activePlayer].Player.CanGoNext || false,
				canGoPrevious: players[activePlayer].Player.CanGoPrevious || false,
				canSeek: players[activePlayer].Player.CanSeek || false,
			},
			status: players[activePlayer].Player.PlaybackStatus || "Stopped",
			loop: players[activePlayer].Player.LoopStatus || "None",
			shuffle: players[activePlayer].Player.Shuffle || false,
			volume: players[activePlayer].Player.Volume || 0,
			elapsed: {
				howMuch:
					Number(await players[activePlayer].Player.GetPosition()) / 1000000,
				when: new Date(),
			},
			app: activePlayer,
			appName: players[activePlayer].Identity || "",
		};
		return update;
	} catch (_) {
		return null;
	}
}

export async function Play() {
	if (activePlayer) await players[activePlayer]?.Player?.Play?.();
}

export async function Pause() {
	if (activePlayer) await players[activePlayer]?.Player?.Pause?.();
}

export async function PlayPause() {
	if (activePlayer) await players[activePlayer]?.Player?.PlayPause?.();
}

export async function Stop() {
	if (activePlayer) await players[activePlayer]?.Player?.Stop?.();
}

export async function Next() {
	if (activePlayer) await players[activePlayer]?.Player?.Next?.();
}

export async function Previous() {
	if (activePlayer) await players[activePlayer]?.Player?.Previous?.();
}

export function Shuffle() {
	if (activePlayer) {
		if (players[activePlayer]?.Player?.Shuffle)
			players[activePlayer].Player.Shuffle = false;
		else players[activePlayer].Player.Shuffle = true;
	}
}

export function Repeat() {
	if (activePlayer) {
		switch (players[activePlayer]?.Player?.LoopStatus) {
			case "None":
			default:
				players[activePlayer].Player.LoopStatus = "Track";
				break;
			case "Track":
				players[activePlayer].Player.LoopStatus = "Playlist";
				break;
			case "Playlist":
				players[activePlayer].Player.LoopStatus = "None";
				break;
		}
	}
}

export async function Seek(offset: number) {
	if (activePlayer) await players[activePlayer]?.Player?.Seek?.(offset);
}

export async function SeekPercentage(percentage: number) {
	if (activePlayer) {
		await players[activePlayer]?.Player?.SetPosition(
			players[activePlayer]?.Player?.Metadata?.["mpris:trackid"],
			// eslint-disable-next-line no-undef
			BigInt(
				Math.floor(
					Number(players[activePlayer]?.Player?.Metadata?.["mpris:length"]) *
						percentage,
				),
			),
		);
		//updateCallback(await getUpdate());
	}
}

export async function SetPosition(position: number) {
	if (activePlayer) {
		await players[activePlayer]?.Player?.SetPosition(
			players[activePlayer]?.Player?.Metadata?.["mpris:trackid"],
			// eslint-disable-next-line no-undef
			BigInt(position * 1000000),
		);
	}
}

export async function GetPosition() {
	let _pos = 0;
	if (activePlayer) {
		const pos = await players[activePlayer]?.Player?.GetPosition?.();
		_pos = Number(pos) / 1000000;
	}
	if (
		shairportSyncConfig.enabled &&
		activePlayer === shairportSyncConfig?.mpris
	) {
		const pos = await GetPositionSharePort();
		_pos = pos.howMuch;
	}
	return {
		howMuch: _pos,
		when: new Date(),
	};
}

// UTILS
async function addPlayer(name: string) {
	try {
		players[name] = await getPlayer(name);
		await players[name].whenReady();
		registerPlayerEvents(name);
		await calculateActivePlayer(name);
		debug("Added player", name);
	} catch (e) {
		debug(`Player ${name} didn't really want to be with us today it seems`);
	}
}

async function deletePlayer(name: string) {
	players[name].destruct();
	delete players[name];
	await calculateActivePlayer();
	debug("Removed player", name);
}

function registerPlayerEvents(name: string) {
	players[name].Player.on("PropertiesChanged", async (changed) => {
		if (name === activePlayer) {
			updateCallback(await getUpdate());
			return;
		}

		if (changed.Metadata || changed.PlaybackStatus === "Playing")
			calculateActivePlayer(name);
	});

	players[name].Player.on("Seeked", async () => {
		if (name === activePlayer) {
			await new Promise((resolve) => setTimeout(resolve, 250)); // wait for new metadata to get populated by media player
			updateCallback(await getUpdate());
			return;
		}

		calculateActivePlayer(name);
	});
}

async function calculateActivePlayer(preferred?: string) {
	let _activePlayer;

	for (let name in players) {
		if (players[name].Player.PlaybackStatus === "Playing") {
			_activePlayer = name;
			break;
		}
	}

	if (!_activePlayer && preferred) _activePlayer = preferred;

	if (!_activePlayer && Object.keys(players).length > 0)
		_activePlayer = Object.keys(players)[0];

	activePlayer = _activePlayer;
	updateCallback(await getUpdate());
}

async function parseMetadata(metadata): Promise<Metadata> {
	let artData: ArtData | undefined;

	if (metadata["mpris:artUrl"]) {
		let artBuffer: Buffer | undefined, artType: string | undefined;

		const artUrl = new URL(metadata["mpris:artUrl"]);
		try {
			switch (artUrl.protocol) {
				case "file:":
					artBuffer = await readFile(artUrl.pathname);
					artType = mime.getType(artUrl.pathname) ?? undefined;
					break;
				case "data:":
					const _mime = artUrl.pathname
						.slice(0, artUrl.pathname.indexOf(","))
						.split(";");
					const data = artUrl.pathname.slice(artUrl.pathname.indexOf(","));

					artBuffer = Buffer.from(data, "base64");
					artType = _mime[0];
					break;
				default:
					try {
						const response = await axios.get<ArrayBuffer>(artUrl.href, {
							responseType: "arraybuffer",
						});
						if (response.status === 200) {
							artBuffer = Buffer.from(response.data);
							artType = response.headers["content-type"];
						}
					} catch (e) {
						debug(
							"MPRIS2 cover art retrieval for artData failed with error",
							e,
						);
					}
					break;
			}
		} catch (e) {
			//...
		}

		if (artBuffer) {
			artData = {
				data: artBuffer,
				type: [artType || "application/octet-stream"],
			};

			try {
				const palettebuffer = await sharp(artBuffer)
					.resize(512, 512, { withoutEnlargement: true })
					.png()
					.toBuffer();
				const palette = await new Vibrant(palettebuffer, {
					colorCount: 16,
					quality: 1,
				}).getPalette();
				artData.palette = {
					DarkMuted: palette.DarkMuted?.hex,
					DarkVibrant: palette.DarkVibrant?.hex,
					LightMuted: palette.LightMuted?.hex,
					LightVibrant: palette.LightVibrant?.hex,
					Muted: palette.Muted?.hex,
					Vibrant: palette.Vibrant?.hex,
				};
			} catch (e) {
				debug("Couldn't compute palette for image", e);
			}
		}
	}

	return {
		title: metadata["xesam:title"],
		artist:
			typeof metadata["xesam:artist"] === "string"
				? metadata["xesam:artist"]
				: metadata["xesam:artist"]?.join("; "),
		artists:
			typeof metadata["xesam:artist"] === "string"
				? [metadata["xesam:artist"]]
				: metadata["xesam:artist"],
		albumArtist:
			typeof metadata["xesam:albumArtist"] === "string"
				? metadata["xesam:albumArtist"]
				: metadata["xesam:albumArtist"]?.join("; "),
		albumArtists:
			typeof metadata["xesam:albumArtist"] === "string"
				? [metadata["xesam:albumArtist"]]
				: metadata["xesam:albumArtist"],
		album:
			typeof metadata["xesam:album"] === "string"
				? metadata["xesam:album"]
				: JSON.stringify(metadata["xesam:album"]), // FUCK YOU NON-COMPLIANT DEVELOPERS, I WILL NOT PUT AN ENDLESS LIST OF QUIRKY APPS HERE
		length: Number(metadata["mpris:length"] || 0) / 1000000,
		artUrl: metadata["mpris:artUrl"],
		artData: artData || undefined,
		count: metadata["xesam:useCount"] || undefined,
		lyrics: metadata["xesam:asText"] || undefined,
		id: metadata["mpris:trackid"],
		location:
			typeof metadata["xesam:url"] === "string"
				? new URL(metadata["xesam:url"])
				: undefined,
	};
}
