const CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ-A-ypK3gTnfLoy5Dgh1yzBY0w2qaH2sSEHhzC8-FlLt7jQhQTQJVQkR1NHYrvKZPYiZlsJAW0zo9V/pub?output=csv';

const VALID_RESULTS = new Set(['Win', 'Loss', 'Draw']);

const DATE_REGEX =
  /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+,\s+\d{4}$/;

const SUMMARY_REGEX = /^\d+\s+(win|loss|draw|game)/i;

// Decks to exclude entirely from all stats (test entries)
const EXCLUDED_DECKS = new Set([
  'Naya Aggro',
  'Random cards from 10 play booster packs',
  'Dimir Control',
  'Toph, the First Metalbender',
]);

// Correct known typos / inconsistent spellings in the sheet
const DECK_NAME_CORRECTIONS = {
  'Xu-Ifit Osteoharmonist':       'Xu-Ifit, Osteoharmonist',
  'Valvagoth, Harrower of Souls': 'Valgavoth, Harrower of Souls',
};

// ── Deck name normalizer ──────────────────────────────────────────────────────

function normalizeDeckName(raw) {
  if (!raw || !raw.trim()) return null;

  let name = raw.trim();

  // Detect borrowed deck before stripping parens
  const borrowedMatch = name.match(/\(borrowed(?:\s+deck)?\s+from\s+[^)]+\)/i);
  const isBorrowed = !!borrowedMatch;
  if (borrowedMatch) {
    name = name.replace(borrowedMatch[0], '').trim();
  }

  // Strip trailing Final Fantasy set codes: (FF6), (FF10), (FF14)
  name = name.replace(/\s*\(FF\d+\)\s*$/, '');

  // Strip trailing color code parentheticals: (WBG), (UR), (WU), (GW), etc.
  name = name.replace(/\s*\([A-Z]{1,7}\)\s*$/, '');

  // Normalize " // " to " / " so variant spellings of the same deck merge
  name = name.replace(/\s*\/\/\s*/g, ' / ');

  name = name.trim();

  // Apply known name corrections
  if (DECK_NAME_CORRECTIONS[name]) {
    name = DECK_NAME_CORRECTIONS[name];
  }

  return { name, isBorrowed };
}

// ── Row classifier ────────────────────────────────────────────────────────────

function classifyRow(row) {
  const col0 = (row[0] || '').trim();
  const col7 = (row[7] || '').trim();

  if (row.every(cell => !cell || !cell.trim())) return 'empty';
  if (DATE_REGEX.test(col0)) return 'date';
  if (col0.toLowerCase().startsWith('playing as') || col0.toLowerCase().startsWith('playing (')) return 'header';
  if (SUMMARY_REGEX.test(col0)) return 'summary';
  if (VALID_RESULTS.has(col7)) return 'game';
  return 'skip';
}

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseRows(rows) {
  const games = [];
  let currentDate = 'Unknown';
  let done = false;

  for (const row of rows) {
    if (done) break;

    const type = classifyRow(row);

    if (type === 'date') {
      currentDate = (row[0] || '').trim();
    } else if (type === 'summary') {
      done = true;
    } else if (type === 'game') {
      const normalized = normalizeDeckName(row[0]);
      if (!normalized) continue;
      if (EXCLUDED_DECKS.has(normalized.name)) continue;

      const opponents = [row[2], row[3], row[4], row[5]]
        .map(s => (s || '').trim())
        .filter(s => s.length > 0);

      games.push({
        date: currentDate,
        parsedDate: new Date(currentDate),
        deck: normalized.name,
        isBorrowed: normalized.isBorrowed,
        opponents,
        result: (row[7] || '').trim(),
        howWon: (row[8] || '').trim(),
        finalPlay: (row[9] || '').trim(),
        notes: (row[10] || '').trim(),
      });
    }
  }

  return games;
}

// ── Stats aggregator ──────────────────────────────────────────────────────────

function aggregateStats(games) {
  const overall = { wins: 0, losses: 0, draws: 0 };
  const byDeck = {};

  for (const g of games) {
    if (g.result === 'Win')        overall.wins++;
    else if (g.result === 'Loss')  overall.losses++;
    else if (g.result === 'Draw')  overall.draws++;

    // Exclude borrowed decks from per-deck breakdown
    if (!g.isBorrowed) {
      if (!byDeck[g.deck]) byDeck[g.deck] = { wins: 0, losses: 0, draws: 0 };
      if (g.result === 'Win')        byDeck[g.deck].wins++;
      else if (g.result === 'Loss')  byDeck[g.deck].losses++;
      else if (g.result === 'Draw')  byDeck[g.deck].draws++;
    }
  }

  overall.total = overall.wins + overall.losses + overall.draws;
  overall.winRate = overall.total > 0
    ? Math.round((overall.wins / overall.total) * 100)
    : 0;

  const deckStats = Object.entries(byDeck)
    .map(([name, counts]) => {
      const total = counts.wins + counts.losses + counts.draws;
      const winRate = total > 0 ? Math.round((counts.wins / total) * 100) : 0;
      return { name, ...counts, total, winRate };
    });

  return { overall, deckStats };
}

// ── Renderers ─────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSummaryCards(overall) {
  document.getElementById('stat-total').textContent   = overall.total;
  document.getElementById('stat-wins').textContent    = overall.wins;
  document.getElementById('stat-losses').textContent  = overall.losses;
  document.getElementById('stat-draws').textContent   = overall.draws;
  document.getElementById('stat-winrate').textContent = overall.winRate + '%';
  document.getElementById('summary-section').hidden = false;
}

// Chart instance kept here so we can destroy & recreate on sort change
let chartInstance = null;

function sortDeckStats(deckStats, sortKey) {
  const sorted = [...deckStats];
  if (sortKey === 'winrate') {
    sorted.sort((a, b) => b.winRate - a.winRate || b.total - a.total);
  } else if (sortKey === 'most-played') {
    sorted.sort((a, b) => b.total - a.total || b.winRate - a.winRate);
  }
  return sorted;
}

function buildChart(deckStats, sortKey) {
  const sorted = sortDeckStats(deckStats, sortKey);

  const labels = sorted.map(d => d.name);
  const wins   = sorted.map(d => d.wins);
  const losses = sorted.map(d => d.losses);
  const draws  = sorted.map(d => d.draws);

  const chartHeight = Math.max(300, sorted.length * 45);
  const canvas = document.getElementById('deckChart');
  const container = canvas.parentElement;
  container.style.height = chartHeight + 'px';

  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  const ctx = canvas.getContext('2d');
  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Wins',
          data: wins,
          backgroundColor: 'rgba(52, 211, 153, 0.85)',
          borderRadius: 2,
        },
        {
          label: 'Losses',
          data: losses,
          backgroundColor: 'rgba(248, 113, 113, 0.85)',
          borderRadius: 2,
        },
        {
          label: 'Draws',
          data: draws,
          backgroundColor: 'rgba(156, 163, 175, 0.6)',
          borderRadius: 2,
        },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      scales: {
        x: {
          stacked: true,
          grid: { color: '#374151' },
          ticks: { color: '#9ca3af' },
          title: { display: true, text: 'Games Played', color: '#9ca3af' },
        },
        y: {
          stacked: true,
          grid: { color: '#2d3748' },
          ticks: { color: '#e5e7eb', font: { size: 11 } },
        }
      },
      plugins: {
        legend: {
          display: true,
          labels: { color: '#e5e7eb', boxWidth: 14 },
        },
        tooltip: {
          mode: 'index',
          callbacks: {
            label: ctx => {
              const labels = ['Wins', 'Losses', 'Draws'];
              return ` ${labels[ctx.datasetIndex]}: ${ctx.parsed.x}`;
            },
            footer: items => {
              const d = sorted[items[0].dataIndex];
              return `Win rate: ${d.winRate}%  (${d.total} games)`;
            }
          }
        }
      }
    }
  });
}

function renderChart(deckStats) {
  buildChart(deckStats, 'most-played');
  document.getElementById('chart-section').hidden = false;
}

// ── Scryfall colour identity ───────────────────────────────────────────────

async function buildColorMap(deckNames) {
  const map = new Map();
  for (const name of deckNames) {
    try {
      const res = await fetch(
        `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`
      );
      if (res.ok) {
        const data = await res.json();
        const ci = data.color_identity;
        if (Array.isArray(ci) && ci.length > 0) {
          map.set(name, ci.join(''));
        }
      }
    } catch { /* skip — card not found or network error */ }
    // Respect Scryfall's rate-limit guideline (50–100 ms between requests)
    await new Promise(r => setTimeout(r, 60));
  }
  return map;
}

async function renderTable(games) {
  // Find most recent game date and calculate 3-month cutoff
  const validDates = games.map(g => g.parsedDate).filter(d => !isNaN(d));
  const maxDate = new Date(Math.max(...validDates));
  const cutoff = new Date(maxDate);
  cutoff.setMonth(cutoff.getMonth() - 3);

  const recent = [...games]
    .reverse()
    .filter(g => !isNaN(g.parsedDate) && g.parsedDate >= cutoff);

  // Fetch colour identity for each unique non-borrowed deck in the table
  const uniqueDecks = [...new Set(recent.filter(g => !g.isBorrowed).map(g => g.deck))];
  const colorMap = await buildColorMap(uniqueDecks);

  const tbody = document.getElementById('game-tbody');

  for (const g of recent) {
    const tr = document.createElement('tr');

    const badgeClass = g.result === 'Win'  ? 'badge-win'
                     : g.result === 'Loss' ? 'badge-loss'
                     : 'badge-draw';

    const colors = colorMap.get(g.deck);
    const colorTag = colors
      ? `<span class="color-tag">(${escapeHtml(colors)})</span>`
      : '';

    const borrowedTag = g.isBorrowed
      ? '<span class="borrowed-tag">(borrowed)</span>'
      : '';

    tr.innerHTML = `
      <td style="white-space:nowrap">${escapeHtml(g.date)}</td>
      <td>${escapeHtml(g.deck)}${colorTag}${borrowedTag}</td>
      <td><span class="badge ${badgeClass}">${escapeHtml(g.result)}</span></td>
      <td>${escapeHtml(g.howWon) || '—'}</td>
    `;
    tbody.appendChild(tr);
  }

  document.getElementById('table-section').hidden = false;
}

// ── Header art ───────────────────────────────────────────────────────────────

// Override to a specific Scryfall card ID when a particular printing is preferred
const HEADER_ART_OVERRIDES = {
  'Xu-Ifit, Osteoharmonist': '98e7fb9e-44c2-4fa6-8d81-895f909ea9b7', // borderless full-art alternate
};

async function fetchHeaderArt(cardName) {
  try {
    const overrideId = HEADER_ART_OVERRIDES[cardName];
    const url = overrideId
      ? `https://api.scryfall.com/cards/${overrideId}`
      : `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    const artUrl = data?.image_uris?.art_crop;
    if (artUrl) {
      document.querySelector('header').style.backgroundImage = `url(${artUrl})`;
    }
  } catch (e) {
    // Silently fail — header falls back to solid colour
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const loading = document.getElementById('loading');
  const errorEl = document.getElementById('error');

  Papa.parse(CSV_URL, {
    download: true,
    skipEmptyLines: false,
    complete: results => {
      loading.hidden = true;
      try {
        const games = parseRows(results.data);

        // Use the most recently played non-borrowed deck as the header art
        const recentGame = [...games].reverse().find(g => !g.isBorrowed);
        fetchHeaderArt(recentGame ? recentGame.deck : 'Death Begets Life');

        const { overall, deckStats } = aggregateStats(games);
        renderSummaryCards(overall);
        renderChart(deckStats);
        renderTable(games);
      } catch (err) {
        errorEl.hidden = false;
        errorEl.textContent = 'Error parsing data: ' + err.message;
        console.error(err);
      }
    },
    error: err => {
      loading.hidden = true;
      errorEl.hidden = false;
      errorEl.textContent = 'Failed to fetch data. Check the browser console for details.';
      console.error(err);
    }
  });
});
