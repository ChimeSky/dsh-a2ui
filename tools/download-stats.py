"""Update the public npm and GitHub download history and its README chart."""
import argparse
from datetime import date, datetime, timedelta, timezone
from itertools import accumulate
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator, StrMethodFormatter


PACKAGE = "dsh-a2ui"
REPOSITORY = "ChimeSky/dsh-a2ui"
NPM_FIRST_DAY = "2026-11-20"  # First publication, UTC.
NPM_DOWNLOADS = f"https://api.npmjs.org/downloads/range/last-year/{PACKAGE}"
GITHUB_RELEASES = f"https://api.github.com/repos/{REPOSITORY}/releases"
NPM_COLOR = "#275bd2"
GITHUB_COLOR = "#00796e"


def fetch_json(url, token=None):
    headers = {"User-Agent": f"{PACKAGE}-download-stats", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    with urlopen(Request(url, headers=headers), timeout=25) as response:
        return json.load(response)


def npm_counts():
    # Use only days processed by npm, starting at the first publication.
    data = fetch_json(NPM_DOWNLOADS)
    counts = {
        item["day"]: item["downloads"]
        for item in data["downloads"]
        if NPM_FIRST_DAY <= item["day"] <= data["end"]
    }
    if not counts:
        raise RuntimeError("npm has no download statistics for this package yet")
    return counts


def release_asset_counts():
    counts = {}
    token = os.environ.get("GITHUB_TOKEN")
    page = 1
    while True:
        releases = fetch_json(f"{GITHUB_RELEASES}?per_page=100&page={page}", token)
        for release in releases:
            if release["draft"]:
                continue
            for asset in release["assets"]:
                name = asset["name"]
                if name.startswith(PACKAGE) and name.endswith(".tgz"):
                    counts[str(asset["id"])] = asset["download_count"]
        if len(releases) < 100:
            return counts
        page += 1


def update_history(history, npm_daily, github_assets, day):
    history["npm_daily"].update(npm_daily)
    # Keep the last reported count if a previously observed asset is removed.
    history["github_assets"].update(github_assets)
    history["github_snapshots"][day] = sum(history["github_assets"].values())


def draw_series(axes, days, totals, color, start):
    points = [
        (day, total)
        for key, total in zip(days, totals)
        if (day := date.fromisoformat(key)) >= start
    ]
    if points:
        dates, values = zip(*points)
        axes.plot(dates, values, color=color, linewidth=2.5, marker="o", markersize=4, zorder=3)


def render_chart(target, history):
    npm_days = sorted(history["npm_daily"])
    npm_total = list(accumulate(history["npm_daily"][day] for day in npm_days))
    github_days = sorted(history["github_snapshots"])
    github_total = [history["github_snapshots"][day] for day in github_days]

    figure = plt.figure(figsize=(9.4, 4.5), dpi=140, facecolor="#ffffff")
    axes = figure.add_axes((0.094, 0.19, 0.86, 0.49))
    figure.text(0.094, 0.91, "dsh-a2ui downloads", color="#18253b", fontsize=18, weight="bold")
    for x, label, total, color in (
        (0.094, "npm package", npm_total[-1], NPM_COLOR),
        (0.53, "GitHub Release assets", github_total[-1], GITHUB_COLOR),
    ):
        figure.text(x, 0.82, label, color=color, fontsize=11, weight="bold")
        figure.text(x, 0.728, f"{total:,}", color=color, fontsize=24, weight="bold")

    end = date.fromisoformat(max(npm_days[-1], github_days[-1]))
    first = date.fromisoformat(min(npm_days[0], github_days[0]))
    start = max(first, end - timedelta(days=29))
    draw_series(axes, npm_days, npm_total, NPM_COLOR, start)
    draw_series(axes, github_days, github_total, GITHUB_COLOR, start)

    axes.set_xlim(mdates.date2num(start) - 0.35, mdates.date2num(end) + 0.35)
    upper = max(max(npm_total), max(github_total))
    axes.set_ylim(0, max(1, upper * 1.12))
    step = max(1, ((end - start).days + 5) // 6)
    axes.xaxis.set_major_locator(mdates.DayLocator(interval=step))
    axes.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
    axes.yaxis.set_major_locator(MaxNLocator(nbins=5, integer=True))
    axes.yaxis.set_major_formatter(StrMethodFormatter("{x:,.0f}"))
    axes.tick_params(axis="both", length=0, pad=9, colors="#475569", labelsize=9)
    axes.grid(axis="y", color="#e3e9f2")
    for spine in axes.spines.values():
        spine.set_visible(False)

    figure.text(
        0.094, 0.055,
        f"npm through {npm_days[-1]}  |  GitHub as of {github_days[-1]}  |  UTC",
        color="#475569", fontsize=9,
    )
    figure.savefig(target)
    plt.close(figure)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="Directory containing history.json and trend.png")
    output = parser.parse_args().output
    archive = output / "history.json"
    history = (
        json.loads(archive.read_text(encoding="utf-8"))
        if archive.exists()
        else {"npm_daily": {}, "github_assets": {}, "github_snapshots": {}}
    )
    day = datetime.now(timezone.utc).date().isoformat()
    update_history(history, npm_counts(), release_asset_counts(), day)
    output.mkdir(parents=True, exist_ok=True)
    render_chart(output / "trend.png", history)
    archive.write_text(json.dumps(history, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    print(f"npm: {sum(history['npm_daily'].values()):,} | GitHub: {history['github_snapshots'][day]:,}")


if __name__ == "__main__":
    main()
