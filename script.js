const CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ-A-ypK3gTnfLoy5Dgh1yzBY0w2qaH2sSEHhzC8-FlLt7jQhQTQJVQkR1NHYrvKZPYiZlsJAW0zo9V/pub?output=csv';

const VALID_RESULTS = new Set(['Win', 'Loss', 'Draw']);

const DATE_REGEX =
  /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+,\s+\d{4}$/;

const SUMMARY_REGEX = /^\d+\s+(win|loss|draw|game)/i;

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

  // Strip trailing color code parentheticals: (WBG), (UR), (WU), (GW), (Jeskai Backup Commander), etc.
  // Match a trailing paren group that is 1-7 uppercase letters only, or known commander role labels
  name = name.replace(/\s*\([A-Z]{1,7}\)\s*$/, '');

  // Strip any remaining trailing whitespace
  name = name.trim();

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

      const opponents = [row[2], row[3], row[4], row[5]]
        .map(s => (s || '').trim())
        .filter(s => s.length > 0);

      games.push({
        date: currentDate,
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
    })
    .sort((a, b) => b.total - a.total);

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

function renderChart(deckStats) {
  const filtered = deckStats.filter(d => d.total >= 2);

  const labels   = filtered.map(d => d.name);
  const winRates = filtered.map(d => d.winRate);
  const colors   = winRates.map(r =>
    r >= 50 ? 'rgba(16, 185, 129, 0.8)'
    : r >= 30 ? 'rgba(245, 158, 11, 0.8)'
    : 'rgba(239, 68, 68, 0.8)'
  );

  const chartHeight = Math.max(300, filtered.length * 28);
  const canvas = document.getElementById('deckChart');
  canvas.style.height = chartHeight + 'px';

  const ctx = canvas.getContext('2d');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Win Rate %',
        data: winRates,
        backgroundColor: colors,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      scales: {
        x: {
          min: 0,
          max: 100,
          grid: { color: '#374151' },
          ticks: { color: '#9ca3af', callback: v => v + '%' }
        },
        y: {
          grid: { color: '#2d3748' },
          ticks: { color: '#e5e7eb', font: { size: 11 } }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const d = filtered[ctx.dataIndex];
              return ` ${d.winRate}%  (${d.wins}W / ${d.losses}L / ${d.draws}D — ${d.total} games)`;
            }
          }
        }
      }
    }
  });

  document.getElementById('chart-section').hidden = false;
}

function renderTable(games) {
  const tbody = document.getElementById('game-tbody');
  const sorted = [...games].reverse();

  for (const g of sorted) {
    const tr = document.createElement('tr');

    const badgeClass = g.result === 'Win'  ? 'badge-win'
                     : g.result === 'Loss' ? 'badge-loss'
                     : 'badge-draw';

    const opponentsHtml = g.opponents.length > 0
      ? g.opponents.map(o => escapeHtml(o)).join('<br>')
      : '—';

    const borrowedTag = g.isBorrowed
      ? '<span class="borrowed-tag">(borrowed)</span>'
      : '';

    tr.innerHTML = `
      <td style="white-space:nowrap">${escapeHtml(g.date)}</td>
      <td>${escapeHtml(g.deck)}${borrowedTag}</td>
      <td>${opponentsHtml}</td>
      <td><span class="badge ${badgeClass}">${escapeHtml(g.result)}</span></td>
      <td>${escapeHtml(g.howWon) || '—'}</td>
      <td>${escapeHtml(g.finalPlay) || '—'}</td>
      <td>${escapeHtml(g.notes) || '—'}</td>
    `;
    tbody.appendChild(tr);
  }

  document.getElementById('table-section').hidden = false;
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
