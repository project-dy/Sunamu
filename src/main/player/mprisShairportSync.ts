import { exec } from "child_process";
import { ShairportSyncConfig } from "../../types";
import { get as getConfig } from "../config";

const settings: ShairportSyncConfig =
	getConfig<ShairportSyncConfig>("shairPortSync");

let lastcur = 0;
let t = settings.timing;

let now: number;

function updateProgress() {
	const cmd = settings.command;
	exec(cmd, (error, stdout) => {
		if (error) {
			console.error(`exec error: ${error}`);
			return;
		}

		const progstr = stdout.split("variant")[1].trim();
		const [start, cur] = progstr
			.split("/")
			.map(Number)
			.map((i) => i / settings.sampleRate);

		const nowCur = cur - start;

		if (nowCur !== lastcur) {
			t = Date.now() / 1000;
			lastcur = nowCur;
		}

		now = nowCur + Date.now() / 1000 - t;
	});
}

setInterval(updateProgress, settings.interval);

export async function GetPosition() {
	return {
		howMuch: now,
		when: new Date(),
	};
}
