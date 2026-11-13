import { underMarket, vendorFlips, type MarketDeal, type VendorFlip } from '../deals';
import { rate } from '../flowView';
import { saveSettings, type AppState } from '../state';
import { TSM_CREDIT_URL } from '../tsm';
import { ago, h, itemLink, money, nodes, notice, pct, table } from '../ui';

export function renderDeals(state: AppState): HTMLElement {
  const { data, market, settings, latest, tsm } = state;
  const head = h('h1', {}, 'Deals');
  if (!latest) return h('div', {}, head, notice('info', 'Needs an AH scan: import one from the game, or set up the Blizzard API in Settings.'));

  const name = (id: number) => data.items.get(id);
  const link = (id: number) => itemLink(id, name(id)?.name, name(id)?.quality);
  const moreTag = (more: boolean) => (more ? h('span', { class: 'muted small', title: 'Only the 3 cheapest price levels are known; there may be more cheap ones' }, '+') : null);

  // --- vendor flips -----------------------------------------------------------
  const flips = vendorFlips(data, market).filter((f) => f.profit >= 1);
  const flipTable = table<VendorFlip>(
    flips,
    [
      { label: 'Item', value: (f) => name(f.item)?.name ?? '', render: (f) => link(f.item) },
      { label: 'AH price', numeric: true, value: (f) => f.price, render: (f) => money(f.price) },
      { label: 'Vendor pays', numeric: true, value: (f) => f.vendor, render: (f) => money(f.vendor) },
      { label: 'Profit each', numeric: true, value: (f) => f.vendor - f.price, render: (f) => money(f.vendor - f.price) },
      { label: 'Units', numeric: true, title: 'Listed below the vendor price', value: (f) => f.units, render: (f) => [String(f.units), moreTag(f.more)] },
      { label: 'Total profit', numeric: true, value: (f) => f.profit, render: (f) => money(f.profit) },
    ],
    { sortBy: 5, desc: true, empty: 'No listings below vendor price right now.' },
  );

  // --- under market -------------------------------------------------------------
  const results = h('div');
  const opts = () => ({ maxPct: settings.dealMaxPct, minSold: settings.dealMinSold, minProfit: settings.dealMinProfit, cut: settings.cut });
  const drawMarket = () => {
    const deals = underMarket(market, tsm, opts());
    results.replaceChildren(
      table<MarketDeal>(
        deals,
        [
          { label: 'Item', value: (d) => name(d.item)?.name ?? '', render: (d) => link(d.item) },
          { label: 'Price', numeric: true, value: (d) => d.price, render: (d) => money(d.price) },
          { label: 'Market', numeric: true, title: "TSM's average sale price (or market value when it has no sales)", value: (d) => d.reference, render: (d) => money(d.reference) },
          { label: '% of market', numeric: true, value: (d) => d.pct, render: (d) => pct(d.pct) },
          { label: 'Profit each', numeric: true, title: 'Reselling at the market price, after the AH cut', value: (d) => d.profitEach, render: (d) => money(d.profitEach) },
          { label: 'Units', numeric: true, title: 'Listed at or under your limit', value: (d) => d.units, render: (d) => [String(d.units), moreTag(d.more)] },
          { label: 'Total profit', numeric: true, value: (d) => d.profit, render: (d) => money(d.profit) },
          { label: 'Sold/day', numeric: true, title: 'TSM region figure, all sellers', value: (d) => d.soldPerDay, render: (d) => rate(d.soldPerDay) },
          { label: 'Sale rate', numeric: true, title: 'Share of listings that sell (TSM)', value: (d) => d.saleRate, render: (d) => pct(d.saleRate) },
        ],
        { sortBy: 6, desc: true, empty: 'Nothing under your limits right now. Try a higher % of market or a lower minimum profit.' },
      ),
    );
  };

  const num = (value: number, onchange: (v: number) => void, attrs: Record<string, unknown>) =>
    h('input', { type: 'number', value: String(value), class: 'qty', ...attrs, onchange: (e: Event) => { onchange(Number((e.target as HTMLInputElement).value)); saveSettings(settings); drawMarket(); } });

  const alertBox = h('input', {
    type: 'checkbox',
    checked: settings.dealAlerts,
    onchange: async (e: Event) => {
      const box = e.target as HTMLInputElement;
      if (box.checked && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
        const answer = await Notification.requestPermission();
        if (answer !== 'granted') box.checked = false;
      }
      settings.dealAlerts = box.checked;
      saveSettings(settings);
    },
  });

  drawMarket();
  return h(
    'div',
    {},
    ...nodes(
      head,
      h('p', { class: 'muted' }, `From the AH scan of ${ago(latest.takenAt)}. Buy, then resell or vendor. Prices move: check in game before you buy a lot.`),
      h('h2', {}, `Vendor flips (${flips.length})`),
      h('p', { class: 'muted small' }, 'Listed for less than a vendor pays: buy and sell to any vendor. No risk, no waiting.'),
      flipTable,
      h('h2', {}, 'Under market price'),
      tsm
        ? h(
            'p',
            { class: 'muted small' },
            "Listed well below TradeSkillMaster's region price for things that actually sell. Resale assumes you list at that price and pay the AH cut; your own auction house can differ from the region, so check its price history first. Prices from ",
            h('a', { href: TSM_CREDIT_URL, target: '_blank', rel: 'noopener' }, 'TradeSkillMaster'),
            '.',
          )
        : notice('warn', 'Needs TradeSkillMaster data, which this site build does not have for your region.'),
      h(
        'div',
        { class: 'controls' },
        h('label', { class: 'field' }, 'At most ', num(Math.round(settings.dealMaxPct * 100), (v) => (settings.dealMaxPct = Math.min(1, Math.max(0.05, v / 100))), { min: 5, max: 100, step: 5 }), ' % of market'),
        h('label', { class: 'field' }, 'Sells at least ', num(settings.dealMinSold, (v) => (settings.dealMinSold = Math.max(0, v)), { min: 0, step: 1 }), ' a day'),
        h('label', { class: 'field' }, 'Total profit at least ', num(settings.dealMinProfit / 100, (v) => (settings.dealMinProfit = Math.max(0, v) * 100), { min: 0, step: 10 }), ' silver'),
      ),
      results,
      h(
        'label',
        { class: 'field' },
        alertBox,
        ' Notify me when new deals show up (checked after each hourly fetch while the site is open; needs the Blizzard API in Settings).',
      ),
    ),
  );
}
