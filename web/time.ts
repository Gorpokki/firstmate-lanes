export function stamp(iso: string): { stardate: string; localTime: string } {
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
	if (!m) return { stardate: "", localTime: iso };
	const y = Number(m[1]),
		mo = Number(m[2]),
		d = Number(m[3]),
		h = Number(m[4]),
		mi = Number(m[5]);
	const doy =
		Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1;
	const frac = Math.floor(((h * 60 + mi) / 1440) * 10);
	const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	const months = [
		"Jan",
		"Feb",
		"Mar",
		"Apr",
		"May",
		"Jun",
		"Jul",
		"Aug",
		"Sep",
		"Oct",
		"Nov",
		"Dec",
	];
	const wd = days[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
	const h12 = h % 12 === 0 ? 12 : h % 12;
	return {
		stardate: `${y}.${String(doy).padStart(3, "0")}.${frac}`,
		localTime: `${wd} ${months[mo - 1]} ${d}, ${h12}:${String(mi).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`,
	};
}
