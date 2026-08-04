import React, { useState, useEffect, useCallback } from 'react';
import { Plus, ShoppingCart, User, Users, Package, Calendar, Edit2, Check, X, LogOut, Lock, Trash2, ShieldCheck, Mail, SkipForward, RotateCcw, Repeat, Filter, AlertTriangle, Database, TrendingUp, Receipt, Table, DollarSign, FileText, Download, Image as ImageIcon } from 'lucide-react';
import * as AllIcons from 'lucide-react';

// Searchable catalog of product icons (lucide-react component names + search keywords).
// IconByName looks them up at runtime, so an unknown name just falls back to a box.
const ICON_CATALOG = [
  { name: 'Milk', keywords: 'milk dairy gallon cream' },
  { name: 'Egg', keywords: 'egg eggs dozen' },
  { name: 'EggFried', keywords: 'egg fried breakfast' },
  { name: 'Beef', keywords: 'beef cow steak meat' },
  { name: 'Ham', keywords: 'ham pork meat' },
  { name: 'Drumstick', keywords: 'chicken poultry meat drumstick' },
  { name: 'Fish', keywords: 'fish seafood' },
  { name: 'Bird', keywords: 'bird poultry chicken hen' },
  { name: 'Rabbit', keywords: 'rabbit' },
  { name: 'Carrot', keywords: 'carrot vegetable veggie produce' },
  { name: 'Apple', keywords: 'apple fruit produce' },
  { name: 'Cherry', keywords: 'cherry fruit berry produce' },
  { name: 'Grape', keywords: 'grape fruit wine produce' },
  { name: 'Banana', keywords: 'banana fruit produce' },
  { name: 'Citrus', keywords: 'citrus orange lemon lime fruit' },
  { name: 'Wheat', keywords: 'wheat grain flour bread hay' },
  { name: 'Bean', keywords: 'bean beans legume' },
  { name: 'Nut', keywords: 'nut nuts almond' },
  { name: 'Salad', keywords: 'salad greens lettuce vegetable' },
  { name: 'Soup', keywords: 'soup broth stew' },
  { name: 'Sandwich', keywords: 'sandwich lunch' },
  { name: 'Pizza', keywords: 'pizza' },
  { name: 'Croissant', keywords: 'croissant pastry bread bakery' },
  { name: 'Cookie', keywords: 'cookie bakery dessert' },
  { name: 'CakeSlice', keywords: 'cake dessert bakery slice' },
  { name: 'Cake', keywords: 'cake dessert birthday' },
  { name: 'Candy', keywords: 'candy sweet' },
  { name: 'Popcorn', keywords: 'popcorn snack' },
  { name: 'IceCreamCone', keywords: 'ice cream dessert cone' },
  { name: 'Coffee', keywords: 'coffee drink beverage' },
  { name: 'CupSoda', keywords: 'soda drink beverage juice' },
  { name: 'GlassWater', keywords: 'water drink beverage' },
  { name: 'Wine', keywords: 'wine drink alcohol' },
  { name: 'Beer', keywords: 'beer drink alcohol' },
  { name: 'Leaf', keywords: 'leaf herb green' },
  { name: 'Sprout', keywords: 'sprout seedling plant grow microgreens' },
  { name: 'Flower', keywords: 'flower bloom floral' },
  { name: 'Flower2', keywords: 'flower bloom floral' },
  { name: 'TreeDeciduous', keywords: 'tree orchard' },
  { name: 'TreePine', keywords: 'tree pine evergreen' },
  { name: 'Hexagon', keywords: 'honey honeycomb hive' },
  { name: 'Snowflake', keywords: 'frozen cold freeze' },
  { name: 'Vegan', keywords: 'vegan plant' },
  { name: 'Utensils', keywords: 'food meal prepared generic' },
  { name: 'ShoppingBasket', keywords: 'basket produce generic' },
  { name: 'Package', keywords: 'other misc generic box' },
];

const IconByName = ({ name, ...props }) => {
  const C = (name && AllIcons[name]) || AllIcons.Package;
  return <C {...props} />;
};

// Tokenized matcher shared by the name-based auto-search and free-text search.
// Splits the query into words, scores each catalog entry by how many words hit
// its name/keywords (with a light singular/plural fallback), and ranks by score.
// An empty query returns the whole catalog.
const matchIcons = (queryStr) => {
  const tokens = (queryStr || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length === 0) return ICON_CATALOG;
  const scored = ICON_CATALOG.map(ic => {
    const hay = `${ic.name} ${ic.keywords}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (hay.includes(t)) score += 2;
      else if (t.length > 3 && hay.includes(t.replace(/s$/, ''))) score += 1;
    }
    return { ic, score };
  }).filter(x => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.map(x => x.ic);
};

// Self-contained icon picker. Writes the chosen lucide name into a hidden
// input (id = inputId) so the surrounding form can read it on submit.
// `seedName` pre-fills the search with the product name so matching icons
// surface automatically; the farmer can clear or change the search freely.

/**
 * Add inventory, optionally attributing it to the animals it came from.
 *
 * Pooled by default: a day's milk goes in as one batch, and the per-animal
 * amounts are recorded as production history in the herd app rather than
 * splitting the store's inventory eight ways. Turn on separate batches for
 * beef, where a cut needs to stay traceable to the steer through to the sale.
 */
function AddInventory({ product, animals, split, setSplit, onAdd }) {
  const rows = split?.rows ?? [];
  const separate = split?.separate ?? false;
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState('');

  const update = (patch) => setSplit({ rows, separate, ...patch });
  const total = rows.reduce((sum, r) => sum + (parseFloat(r.quantity) || 0), 0);
  const used = new Set(rows.map(r => r.animal_id).filter(Boolean));
  const available = animals.filter(a => !used.has(a.id));
  const ready = rows.length
    ? rows.every(r => r.animal_id && parseFloat(r.quantity) > 0)
    : Boolean(quantity);

  return (
    <div className="bg-gray-50 p-3 rounded mb-3">
      <h4 className="font-semibold mb-2">Add Inventory</h4>

      <div className="flex gap-2 flex-wrap items-center">
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="border rounded px-3 py-2"
        />
        {rows.length === 0 ? (
          <input
            type="number" min="0.001" step="0.001" placeholder="Quantity"
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
            className="border rounded px-3 py-2 w-32"
          />
        ) : (
          <span className="px-3 py-2 text-sm">
            <span className="font-semibold tabular">{total.toFixed(3).replace(/\.?0+$/, '')}</span>
            <span className="text-gray-500"> {product.unit} from {rows.length} animal{rows.length > 1 ? 's' : ''}</span>
          </span>
        )}
        <button
          disabled={!date || !ready}
          onClick={() => {
            const entries = rows
              .filter(r => r.animal_id && parseFloat(r.quantity) > 0)
              .map(r => ({ animal_id: r.animal_id, quantity: parseFloat(r.quantity) }));
            onAdd(product.id, date, quantity, entries, separate);
            setQuantity('');
          }}
          className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {animals.length > 0 && (
        <div className="mt-3">
          {rows.map((row, i) => (
            <div key={i} className="flex gap-2 items-center mb-2 flex-wrap">
              <select
                value={row.animal_id}
                onChange={e => update({
                  rows: rows.map((r, j) => j === i ? { ...r, animal_id: e.target.value } : r)
                })}
                className="border rounded px-3 py-2"
              >
                <option value="">Which animal?</option>
                {animals
                  .filter(a => a.id === row.animal_id || !used.has(a.id))
                  .map(a => (
                    <option key={a.id} value={a.id}>
                      {a.barn_name || `Tag ${a.ear_tag}`}{a.ear_tag && a.barn_name ? ` (${a.ear_tag})` : ''}
                    </option>
                  ))}
              </select>
              <input
                type="number" min="0.001" step="0.001" placeholder="Amount"
                value={row.quantity}
                onChange={e => update({
                  rows: rows.map((r, j) => j === i ? { ...r, quantity: e.target.value } : r)
                })}
                className="border rounded px-3 py-2 w-28"
              />
              <span className="text-sm text-gray-500">{product.unit}</span>
              <button
                onClick={() => update({ rows: rows.filter((_, j) => j !== i) })}
                className="text-sm text-gray-500 px-2 py-2 hover:text-gray-900"
              >
                Remove
              </button>
            </div>
          ))}

          <div className="flex gap-3 items-center flex-wrap">
            <button
              disabled={available.length === 0}
              onClick={() => update({ rows: [...rows, { animal_id: '', quantity: '' }] })}
              className="text-sm border rounded px-3 py-2 hover:bg-gray-100 disabled:opacity-40"
            >
              {rows.length === 0 ? 'Record which animals this came from' : 'Add another animal'}
            </button>

            {rows.length > 0 && (
              <label className="text-sm flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={separate}
                  onChange={e => update({ separate: e.target.checked })}
                />
                Keep each animal&apos;s amount as its own batch
              </label>
            )}
          </div>

          {rows.length > 0 && (
            <p className="text-xs text-gray-500 mt-2">
              {separate
                ? 'Each animal gets its own inventory batch, so a sale can be traced back to the individual animal. Use this for beef.'
                : 'Goes in as one batch. The per-animal amounts are still recorded as production history in the herd app. Use this for milk and eggs.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ProductIconPicker({ inputId, initial = '', seedName = '' }) {
  const [selected, setSelected] = useState(initial);
  const [query, setQuery] = useState(seedName);
  const results = matchIcons(query);
  return (
    <div>
      <input type="hidden" id={inputId} value={selected} readOnly />
      <label className="block text-sm text-gray-600 mb-1">Product icon</label>
      <input
        type="text"
        placeholder="Search icons — e.g. milk, egg, carrot, honey"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="border rounded px-3 py-2 w-full mb-2"
      />
      <div className="grid grid-cols-8 gap-1 max-h-40 overflow-y-auto p-1 border rounded">
        {results.map(ic => {
          const C = AllIcons[ic.name] || AllIcons.Package;
          const isSel = selected === ic.name;
          return (
            <button
              key={ic.name}
              type="button"
              title={ic.name}
              onClick={() => setSelected(isSel ? '' : ic.name)}
              className={`flex items-center justify-center p-2 rounded ${isSel ? 'bg-green-600 text-white' : 'hover:bg-gray-100 text-gray-600'}`}
            >
              <C size={20} />
            </button>
          );
        })}
        {results.length === 0 && (
          <p className="col-span-8 text-xs text-gray-400 p-2">
            No icons match "{query}". Clear the box to browse all icons.
          </p>
        )}
      </div>
      {selected && (
        <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
          Selected: <IconByName name={selected} size={14} /> {selected}
        </p>
      )}
    </div>
  );
}

// Optionally hardcode these so the setup screen is skipped:
const SUPABASE_URL = 'https://qpthtykkqxpujudyieyr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwdGh0eWtrcXhwdWp1ZHlpZXlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMDgzODEsImV4cCI6MjA5NjY4NDM4MX0.VXgzPAvIYUCae8KT4t9Xbt60SdsdC_QHwBN9RwlQQ1A';

const VENMO_LINK = 'https://venmo.com/u/Chris-Suchomski';

// Portability shim: inside Claude, window.storage exists. When this code is
// deployed as a real web app (Vercel, Netlify, etc.), fall back to localStorage.
if (typeof window !== 'undefined' && !window.storage) {
  window.storage = {
    async get(key) {
      const v = localStorage.getItem(key);
      if (v === null) throw new Error('Key not found');
      return { key, value: v };
    },
    async set(key, value) { localStorage.setItem(key, value); return { key, value }; },
    async delete(key) { localStorage.removeItem(key); return { key, deleted: true }; }
  };
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DISCARD_REASONS = ['Fed to Pigs', 'Poured out'];
const SUPPLY_TABLE_DAYS = 28; // how far back the editable supply table looks

// Quantities support up to 3 decimal places everywhere
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const parseQty = (raw) => round3(parseFloat(raw));
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const priceOf = (product) => Number(product?.price) || 0;
const hasPrice = (product) => product?.price !== null && product?.price !== undefined;

const formatPhone = (raw) => {
  let digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return raw || '';
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

const toLocalISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const getNextPickupDate = (item) => {
  const jsDay = (DAYS.indexOf(item.day) + 1) % 7;
  let d = new Date();
  d.setHours(0, 0, 0, 0);
  if (item.start_date) {
    const start = new Date(item.start_date + 'T00:00:00');
    if (start > d) d = start;
  }
  while (d.getDay() !== jsDay) d.setDate(d.getDate() + 1);
  // Both skipped and already-fulfilled occurrences roll the date forward
  const blocked = [...(item.skipped_dates || []), ...(item.fulfilled_dates || [])];
  while (blocked.includes(toLocalISO(d))) d.setDate(d.getDate() + 7);
  return d;
};

const fullName = (p) => p ? `${p.first_name} ${p.last_name}`.trim() : '';

const FarmInventoryApp = () => {
  const [config, setConfig] = useState(null);          // { url, key }
  const [configChecked, setConfigChecked] = useState(false);
  const [session, setSession] = useState(null);        // { access_token, refresh_token, user }
  const [profile, setProfile] = useState(null);        // current user's profile row
  const [view, setView] = useState('shop');
  const [authView, setAuthView] = useState('login');
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [profiles, setProfiles] = useState([]);        // all users (farmer only)
  const [schedules, setSchedules] = useState([]);
  const [discards, setDiscards] = useState([]);
  const [herdAnimals, setHerdAnimals] = useState([]);
  const [splits, setSplits] = useState({});
  const [stats, setStats] = useState({});              // product_id -> supply/demand stats
  const [showNewProduct, setShowNewProduct] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [editingScheduleId, setEditingScheduleId] = useState(null);
  const [editingBatchId, setEditingBatchId] = useState(null);
  const [editingIconId, setEditingIconId] = useState(null);   // product whose icon is being edited
  const [schedulingProduct, setSchedulingProduct] = useState(null);
  const [orderFilter, setOrderFilter] = useState('active');
  const [payment, setPayment] = useState(null);        // { kind:'order'|'schedule', id, finalQty, qty, total, productName, unit }
  const [payMethod, setPayMethod] = useState(null);    // null | 'Cash' | 'Venmo'
  const [authError, setAuthError] = useState('');
  const [authSuccess, setAuthSuccess] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  const isFarmer = profile?.role === 'farmer';

  // ---------- Supabase REST helpers (plain fetch; no SDK needed) ----------
  const authFetch = async (cfg, path, body) => {
    const res = await fetch(`${cfg.url}/auth/v1${path}`, {
      method: 'POST',
      headers: { apikey: cfg.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.msg || data.error_description || data.message || 'Authentication failed');
    return data;
  };

  const rest = useCallback(async (path, { method = 'GET', body, token, schema } = {}) => {
    const accessToken = token || session?.access_token;
    // The herd app's tables live in their own `herd` schema so they cannot
    // collide with this app's. PostgREST selects a schema per request via these
    // headers — Accept-Profile for reads, Content-Profile for writes.
    const schemaHeaders = schema
      ? (method === 'GET'
          ? { 'Accept-Profile': schema }
          : { 'Content-Profile': schema, 'Accept-Profile': schema })
      : {};
    const res = await fetch(`${config.url}/rest/v1${path}`, {
      method,
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...schemaHeaders
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(data?.message || data?.hint || 'Request failed');
    }
    return data;
  }, [config, session]);

  // ---------- Data loading ----------
  const loadAll = useCallback(async (cfg, sess, prof) => {
    const c = cfg || config;
    const s = sess || session;
    const p = prof || profile;
    if (!c || !s) return;
    const get = async (path) => {
      const res = await fetch(`${c.url}/rest/v1${path}`, {
        headers: { apikey: c.key, Authorization: `Bearer ${s.access_token}` }
      });
      if (!res.ok) return [];
      return res.json();
    };
    const [prods, ords, scheds, statRows] = await Promise.all([
      get('/products?select=*,inventory_batches(*)&order=name'),
      get('/orders?select=*,customer:profiles(first_name,last_name)&order=reserved_date.desc'),
      get('/schedules?select=*,owner:profiles(first_name,last_name),product:products(name)&order=id'),
      get('/rpc/product_stats')
    ]);
    setProducts(prods || []);
    setOrders(ords || []);
    setSchedules(scheds || []);
    setStats(Object.fromEntries((statRows || []).map(r => [r.product_id, {
      ...r,
      on_hand: Number(r.on_hand),
      active_reserved: Number(r.active_reserved),
      incoming_forecast: Number(r.incoming_forecast),
      scheduled_demand: Number(r.scheduled_demand),
      shoppable: Number(r.shoppable)
    }])));
    if (p?.role === 'farmer') {
      const getHerd = async (path) => {
        const res = await fetch(`${c.url}/rest/v1${path}`, {
          headers: {
            apikey: c.key,
            Authorization: `Bearer ${s.access_token}`,
            'Accept-Profile': 'herd'
          }
        });
        if (!res.ok) return [];
        return res.json();
      };
      const animals = await getHerd(
        '/animals?select=id,barn_name,ear_tag,purpose,class' +
        '&record_type=eq.herd&status=eq.active&deleted_at=is.null&order=barn_name'
      );
      setHerdAnimals(animals || []);

      const [profs, discs] = await Promise.all([
        get('/profiles?select=*&order=created_at'),
        get('/discards?select=*&order=created_at.desc')
      ]);
      setProfiles(profs || []);
      setDiscards(discs || []);
    }
  }, [config, session, profile]);

  const fetchProfile = async (cfg, sess) => {
    const res = await fetch(
      `${cfg.url}/rest/v1/profiles?id=eq.${sess.user.id}&select=*`,
      { headers: { apikey: cfg.key, Authorization: `Bearer ${sess.access_token}` } }
    );
    const rows = await res.json().catch(() => []);
    return rows?.[0] || null;
  };

  const establishSession = async (cfg, sess) => {
    await window.storage.set('farm-auth', JSON.stringify({
      refresh_token: sess.refresh_token
    })).catch(() => {});
    const prof = await fetchProfile(cfg, sess);
    setSession(sess);
    setProfile(prof);
    await loadAll(cfg, sess, prof);
  };

  // ---------- Startup: load config, restore session ----------
  useEffect(() => {
    const init = async () => {
      try {
        let cfg = null;
        if (SUPABASE_URL && SUPABASE_ANON_KEY) {
          cfg = { url: SUPABASE_URL, key: SUPABASE_ANON_KEY };
        } else {
          const saved = await window.storage.get('farm-supabase-config', true).catch(() => null);
          if (saved) cfg = JSON.parse(saved.value);
        }
        if (!cfg) {
          setConfigChecked(true);
          setLoading(false);
          return;
        }
        setConfig(cfg);
        setConfigChecked(true);

        const savedAuth = await window.storage.get('farm-auth').catch(() => null);
        if (savedAuth) {
          const { refresh_token } = JSON.parse(savedAuth.value);
          if (refresh_token) {
            try {
              const sess = await authFetch(cfg, '/token?grant_type=refresh_token', { refresh_token });
              await establishSession(cfg, sess);
            } catch (e) {
              await window.storage.delete('farm-auth').catch(() => {});
            }
          }
        }
      } catch (e) {
        console.error('Init error:', e);
      } finally {
        setLoading(false);
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = () => loadAll();

  const runAction = async (fn) => {
    setNotice('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setNotice(e.message);
    }
  };

  // ---------- Auth actions ----------
  const register = async ({ firstName, lastName, email, phone, password, confirmPassword }) => {
    setAuthError('');
    if (!firstName || !lastName || !email || !phone || !password) {
      setAuthError('All fields are required.'); return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAuthError('Please enter a valid email address.'); return;
    }
    if (password.length < 8) {
      setAuthError('Password must be at least 8 characters long.'); return;
    }
    if (password !== confirmPassword) {
      setAuthError('Passwords do not match.'); return;
    }
    setAuthLoading(true);
    try {
      const data = await authFetch(config, '/signup', {
        email: email.trim().toLowerCase(),
        password,
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone: formatPhone(phone)
        }
      });
      if (data.access_token) {
        await establishSession(config, data);
        setView('shop');
      } else {
        setAuthView('login');
        setAuthSuccess('Account created! Check your email to confirm, then sign in.');
      }
    } catch (e) {
      setAuthError(e.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const login = async ({ email, password }) => {
    setAuthError('');
    if (!email || !password) { setAuthError('Email and password are required.'); return; }
    setAuthLoading(true);
    try {
      const sess = await authFetch(config, '/token?grant_type=password', {
        email: email.trim().toLowerCase(), password
      });
      await establishSession(config, sess);
      setView('shop');
    } catch (e) {
      setAuthError('Invalid email or password.');
    } finally {
      setAuthLoading(false);
    }
  };

  const sendPasswordReset = async (email) => {
    setAuthError('');
    if (!email) { setAuthError('Please enter your email address.'); return; }
    setAuthLoading(true);
    try {
      await authFetch(config, '/recover', { email: email.trim().toLowerCase() });
      setAuthView('login');
      setAuthSuccess('Password reset email sent. Follow the link in the email, then sign in.');
    } catch (e) {
      setAuthError(e.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = async () => {
    await window.storage.delete('farm-auth').catch(() => {});
    setSession(null);
    setProfile(null);
    setProducts([]); setOrders([]); setSchedules([]); setProfiles([]); setDiscards([]);
    setStats({});
    setAuthView('login');
    setAuthError('');
    setView('shop');
  };

  // ---------- Data actions (all enforced server-side by RLS) ----------
  const addProduct = (name, unit, price) =>
    runAction(() => rest('/products', { method: 'POST', body: { name, unit, price: price === '' || price == null ? null : parseQty(price) } }));

  const setProductPrice = (productId, price) =>
    runAction(() => rest(`/products?id=eq.${productId}`, {
      method: 'PATCH', body: { price: price === '' || price == null ? null : parseQty(price) }
    }));

  const setProductIcon = (productId, icon) =>
    runAction(() => rest(`/products?id=eq.${productId}`, {
      method: 'PATCH', body: { icon: icon ? icon : null }
    }));

  const addInventory = (productId, producedDate, quantity, entries = [], separateBatches = false) =>
    runAction(async () => {
      await rest('/rpc/record_production', {
        method: 'POST',
        schema: 'herd',
        body: {
          p_product_id: productId,
          p_produced_date: producedDate,
          p_entries: entries,
          p_pooled: !separateBatches,
          p_quantity: entries.length ? null : parseQty(quantity)
        }
      });
      setSplits(prev => ({ ...prev, [productId]: undefined }));
    });

  const updateBatch = (batchId, patch) =>
    runAction(() => rest(`/inventory_batches?id=eq.${batchId}`, { method: 'PATCH', body: patch }));

  const deleteBatch = (batchId) =>
    runAction(() => rest(`/inventory_batches?id=eq.${batchId}`, { method: 'DELETE' }));

  const setForecastOverride = (productId, value) =>
    runAction(() => rest(`/products?id=eq.${productId}`, {
      method: 'PATCH', body: { forecast_override: value }
    }));

  const reserveProduct = (productId, quantity, forCustomerId) =>
    runAction(() => rest('/rpc/reserve_product', {
      method: 'POST',
      body: { p_product_id: productId, p_quantity: quantity, p_customer: forCustomerId || null }
    }));

  const cancelOrder = (orderId) =>
    runAction(() => rest('/rpc/cancel_order', { method: 'POST', body: { p_order_id: orderId } }));

  // Pickup + payment for a one-time order
  const completePickup = (orderId, finalQuantity, paymentMethod, amountPaid) =>
    runAction(async () => {
      await rest('/rpc/complete_pickup', {
        method: 'POST',
        body: {
          p_order_id: orderId,
          p_final_quantity: finalQuantity,
          p_payment_method: paymentMethod || null,
          p_amount_paid: amountPaid == null ? null : round3(amountPaid)
        }
      });
      setEditingOrder(null);
    });

  // Pickup + payment for a scheduled weekly order
  const completeScheduledPickup = (scheduleId, paymentMethod, amountPaid) =>
    runAction(() => rest('/rpc/complete_scheduled_pickup', {
      method: 'POST',
      body: {
        p_schedule_id: scheduleId,
        p_quantity: null,
        p_payment_method: paymentMethod || null,
        p_amount_paid: amountPaid == null ? null : round3(amountPaid)
      }
    }));

  const discardInventory = (productId, quantity, reason, batchId = null) =>
    runAction(() => rest('/rpc/discard_inventory', {
      method: 'POST',
      body: { p_product_id: productId, p_quantity: quantity, p_reason: reason, p_batch_id: batchId }
    }));

  const promoteToFarmer = (userId) =>
    runAction(() => rest(`/profiles?id=eq.${userId}`, { method: 'PATCH', body: { role: 'farmer' } }));

  const addSchedule = (customerId, productId, quantity, day, startDate) =>
    runAction(() => rest('/schedules', {
      method: 'POST',
      body: {
        customer_id: customerId, product_id: productId, quantity: parseQty(quantity),
        day, start_date: startDate || null, skipped_dates: []
      }
    }));

  const updateSchedule = (id, patch) =>
    runAction(() => rest(`/schedules?id=eq.${id}`, { method: 'PATCH', body: patch }));

  const deleteSchedule = (id) =>
    runAction(() => rest(`/schedules?id=eq.${id}`, { method: 'DELETE' }));

  // ---------- Payment flow ----------
  // Open the payment modal for an order (one-time) or a schedule (weekly).
  const openPaymentForOrder = (order, finalQty) => {
    const product = products.find(p => p.id === order.product_id);
    const qty = finalQty != null ? finalQty : order.quantity;
    setPayMethod(null);
    setPayment({
      kind: 'order', id: order.id, finalQty: qty, qty,
      total: round3(priceOf(product) * qty),
      productName: product?.name || 'Product', unit: product?.unit || ''
    });
  };
  const openPaymentForSchedule = (item) => {
    const product = products.find(p => p.id === item.product_id);
    setPayMethod(null);
    setPayment({
      kind: 'schedule', id: item.id, finalQty: item.quantity, qty: item.quantity,
      total: round3(priceOf(product) * item.quantity),
      productName: item.product?.name || product?.name || 'Product', unit: product?.unit || ''
    });
  };
  const finalizePayment = (method, amountPaid) => {
    if (!payment) return;
    if (payment.kind === 'order') {
      completePickup(payment.id, payment.finalQty, method, amountPaid);
    } else {
      completeScheduledPickup(payment.id, method, amountPaid);
    }
    setPayment(null);
    setPayMethod(null);
  };

  // ---------- Helpers ----------
  const getAvailableQuantity = (product) => {
    const batches = product.inventory_batches || [];
    return round3(batches.reduce((sum, b) => sum + (Number(b.quantity) - Number(b.reserved || 0)), 0));
  };
  const getTotalReserved = (product) => {
    const batches = product.inventory_batches || [];
    return round3(batches.reduce((sum, b) => sum + Number(b.reserved || 0), 0));
  };
  const getPendingOrders = (productId) =>
    orders.filter(o => o.product_id === productId && o.status === 'reserved');

  const getStats = (product) => {
    const raw = getAvailableQuantity(product);
    return stats[product.id] || {
      on_hand: raw, active_reserved: getTotalReserved(product),
      incoming_forecast: 0, scheduled_demand: 0, shoppable: raw
    };
  };

  const filterOrders = (list) => {
    if (orderFilter === 'active') return list.filter(o => o.status === 'reserved');
    if (orderFilter === 'completed') return list.filter(o => o.status === 'completed');
    if (orderFilter === 'cancelled') return list.filter(o => o.status === 'cancelled');
    return list;
  };

  const composeEmail = (to, bcc) => {
    const subject = document.getElementById('email-subject')?.value || '';
    const body = document.getElementById('email-body')?.value || '';
    const params = [];
    if (bcc) params.push(`bcc=${encodeURIComponent(bcc)}`);
    if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
    if (body) params.push(`body=${encodeURIComponent(body)}`);
    window.open(`mailto:${to || ''}${params.length ? '?' + params.join('&') : ''}`, '_blank');
  };

  // ---------- Shared UI ----------
  const Notice = () => notice ? (
    <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2 mb-4 flex justify-between items-center">
      <span>{notice}</span>
      <button onClick={() => setNotice('')} className="text-red-400 hover:text-red-700"><X size={16} /></button>
    </div>
  ) : null;

  // Payment modal — appears when a pickup is being recorded
  const PaymentModal = () => {
    if (!payment) return null;
    const priceKnown = payment.total > 0 || payment.unit; // total may be 0 if no price set
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
        onClick={() => { setPayment(null); setPayMethod(null); }}>
        <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl" onClick={e => e.stopPropagation()}>
          <div className="flex justify-between items-center mb-1">
            <h3 className="text-xl font-bold tracking-tight">Record Pickup</h3>
            <button onClick={() => { setPayment(null); setPayMethod(null); }} className="text-gray-400 hover:text-gray-700">
              <X size={20} />
            </button>
          </div>
          <p className="text-sm text-gray-600 mb-1">
            {payment.qty} {payment.unit} {payment.productName}
          </p>
          <p className="text-2xl font-bold text-green-700 mb-4">
            Total due: {money(payment.total)}
          </p>

          {!payMethod && (
            <div className="grid gap-2">
              <p className="text-sm font-semibold text-gray-700">How are you paying?</p>
              <button onClick={() => setPayMethod('Cash')}
                className="border border-gray-300 rounded-xl px-4 py-3 text-left hover:border-green-500 hover:bg-green-50 flex items-center gap-2">
                <DollarSign size={18} className="text-green-600" /> Cash
              </button>
              <button onClick={() => setPayMethod('Venmo')}
                className="border border-gray-300 rounded-xl px-4 py-3 text-left hover:border-blue-500 hover:bg-blue-50 flex items-center gap-2">
                <span className="font-bold text-blue-600">V</span> Venmo
              </button>
            </div>
          )}

          {payMethod === 'Cash' && (
            <div className="grid gap-3">
              <label className="text-sm font-semibold text-gray-700">Amount paid (cash)</label>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">$</span>
                <input type="number" min="0" step="0.01" defaultValue={payment.total > 0 ? payment.total.toFixed(2) : ''}
                  id="pay-cash-amount" className="border border-gray-300 rounded-lg px-3 py-2 w-full" autoFocus />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setPayMethod(null)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-full hover:bg-gray-300">
                  Back
                </button>
                <button
                  onClick={() => {
                    const amt = round3(parseFloat(document.getElementById('pay-cash-amount').value));
                    if (isNaN(amt) || amt < 0) { setNotice('Enter a valid cash amount.'); return; }
                    finalizePayment('Cash', amt);
                  }}
                  className="bg-green-600 text-white px-4 py-2 rounded-full font-semibold hover:bg-green-700 flex-1">
                  Confirm Cash Payment
                </button>
              </div>
            </div>
          )}

          {payMethod === 'Venmo' && (
            <div className="grid gap-3">
              <p className="text-sm text-gray-700">
                Please send {money(payment.total)} via Venmo, then confirm below.
              </p>
              <a href={VENMO_LINK} target="_blank" rel="noopener noreferrer"
                className="bg-blue-600 text-white px-4 py-3 rounded-xl font-semibold hover:bg-blue-700 text-center break-all">
                Pay on Venmo →
              </a>
              <p className="text-xs text-gray-500 break-all">{VENMO_LINK}</p>
              <div className="flex gap-2">
                <button onClick={() => setPayMethod(null)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-full hover:bg-gray-300">
                  Back
                </button>
                <button onClick={() => finalizePayment('Venmo', payment.total)}
                  className="bg-green-600 text-white px-4 py-2 rounded-full font-semibold hover:bg-green-700 flex-1">
                  I've Paid via Venmo
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const OrderFilterBar = () => (
    <div className="flex items-center gap-2 mb-3 flex-wrap">
      <Filter size={16} className="text-gray-500" />
      {[
        { id: 'active', label: 'Active' },
        { id: 'all', label: 'All' },
        { id: 'completed', label: 'Completed' },
        { id: 'cancelled', label: 'Cancelled' }
      ].map(f => (
        <button
          key={f.id}
          onClick={() => setOrderFilter(f.id)}
          className={`text-sm px-3 py-1 rounded-full border ${
            orderFilter === f.id
              ? 'bg-green-600 text-white border-green-600'
              : 'bg-white text-gray-600 hover:border-green-400'
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );

  const OrderCard = ({ order, showCustomer }) => {
    const product = products.find(p => p.id === order.product_id);
    const unitPrice = order.status === 'completed' && order.unit_price != null ? Number(order.unit_price) : priceOf(product);
    const lineTotal = order.status === 'completed' && order.total_cost != null
      ? Number(order.total_cost)
      : round3(unitPrice * order.quantity);
    return (
      <div className="border rounded-lg p-4 bg-gray-50">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2">
              {product?.icon && <IconByName name={product.icon} size={18} className="text-green-700" />}
              <h3 className="font-semibold">{product?.name || 'Product'}</h3>
              {order.schedule_id && (
                <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Repeat size={10} /> Weekly
                </span>
              )}
            </div>
            {showCustomer && (
              <p className="text-sm text-blue-700">{fullName(order.customer)}</p>
            )}
            <p className="text-sm text-gray-600">
              {editingOrder === order.id ? (
                <input
                  type="number" min="0" max={order.quantity} step="0.001" defaultValue={order.quantity}
                  className="border rounded px-2 py-1 w-24" id={`edit-qty-${order.id}`}
                />
              ) : (
                `Quantity: ${order.quantity}`
              )}
            </p>
            {unitPrice > 0 && (
              <p className="text-sm text-gray-700 font-medium">
                {money(unitPrice)} × {order.quantity} = {money(lineTotal)}
              </p>
            )}
            <p className="text-xs text-gray-500">
              Reserved: {new Date(order.reserved_date).toLocaleDateString()}
            </p>
            {order.status === 'completed' && order.payment_method && (
              <p className="text-xs text-gray-500">
                Paid {money(order.amount_paid)} via {order.payment_method}
              </p>
            )}
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            {order.status === 'reserved' && (
              <>
                {editingOrder === order.id ? (
                  <>
                    <button
                      onClick={() => {
                        const qty = parseQty(document.getElementById(`edit-qty-${order.id}`).value);
                        openPaymentForOrder(order, qty);
                      }}
                      className="bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 flex items-center gap-1"
                    >
                      <Check size={16} /> Confirm
                    </button>
                    <button onClick={() => setEditingOrder(null)} className="bg-gray-500 text-white px-3 py-1 rounded hover:bg-gray-600">
                      <X size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => openPaymentForOrder(order)} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
                      Picked Up
                    </button>
                    <button onClick={() => setEditingOrder(order.id)} className="bg-gray-500 text-white px-3 py-2 rounded hover:bg-gray-600" title="Edit quantity at pickup">
                      <Edit2 size={16} />
                    </button>
                    <button onClick={() => cancelOrder(order.id)} className="bg-red-600 text-white px-3 py-2 rounded hover:bg-red-700" title="Unclaim (cancel reservation)">
                      <Trash2 size={16} />
                    </button>
                  </>
                )}
              </>
            )}
            {order.status === 'completed' && (
              <span className="bg-green-100 text-green-800 px-3 py-1 rounded">✓ Completed</span>
            )}
            {order.status === 'cancelled' && (
              <span className="bg-gray-200 text-gray-600 px-3 py-1 rounded">Cancelled</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  const ScheduleItemCard = ({ item, showOwner }) => {
    const isEditing = editingScheduleId === item.id;
    const product = products.find(p => p.id === item.product_id);
    const lineTotal = round3(priceOf(product) * item.quantity);
    const nextPickup = getNextPickupDate(item);
    const hasSkips = (item.skipped_dates || []).length > 0;
    const fulfilled = [...(item.fulfilled_dates || [])].sort();
    const lastPickedUp = fulfilled.length > 0 ? fulfilled[fulfilled.length - 1] : null;

    return (
      <div className="border rounded-lg p-4 flex justify-between items-center flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2">
            {product?.icon && <IconByName name={product.icon} size={18} className="text-green-700" />}
            <h3 className="font-semibold">{item.product?.name || 'Product'}</h3>
            {showOwner && (
              <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                {fullName(item.owner)}
              </span>
            )}
          </div>
          {isEditing ? (
            <div className="flex gap-2 mt-1 flex-wrap">
              <input type="number" min="0.001" step="0.001" defaultValue={item.quantity} id={`sched-edit-qty-${item.id}`} className="border rounded px-2 py-1 w-24" />
              <select id={`sched-edit-day-${item.id}`} defaultValue={item.day} className="border rounded px-2 py-1">
                {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <input type="date" defaultValue={item.start_date || ''} id={`sched-edit-start-${item.id}`} className="border rounded px-2 py-1" title="Start date" />
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-600">
                Quantity: {item.quantity} | Every {item.day}
                {item.start_date && ` | Starts: ${new Date(item.start_date + 'T00:00:00').toLocaleDateString()}`}
              </p>
              {priceOf(product) > 0 && (
                <p className="text-sm text-gray-700 font-medium">
                  {money(priceOf(product))} × {item.quantity} = {money(lineTotal)} per pickup
                </p>
              )}
              <p className="text-sm text-green-700 font-medium">
                Next pickup: {nextPickup.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
              </p>
              {lastPickedUp && (
                <p className="text-xs text-gray-500">
                  Last picked up: {new Date(lastPickedUp + 'T00:00:00').toLocaleDateString()}
                </p>
              )}
              {hasSkips && (
                <p className="text-xs text-orange-600">
                  Skipped: {item.skipped_dates.map(d => new Date(d + 'T00:00:00').toLocaleDateString()).join(', ')}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {isEditing ? (
            <>
              <button
                onClick={() => {
                  const qty = parseQty(document.getElementById(`sched-edit-qty-${item.id}`).value);
                  const day = document.getElementById(`sched-edit-day-${item.id}`).value;
                  const startDate = document.getElementById(`sched-edit-start-${item.id}`).value;
                  if (qty > 0 && day) {
                    updateSchedule(item.id, { quantity: qty, day, start_date: startDate || null });
                    setEditingScheduleId(null);
                  }
                }}
                className="bg-green-600 text-white px-3 py-2 rounded hover:bg-green-700"
              >
                <Check size={16} />
              </button>
              <button onClick={() => setEditingScheduleId(null)} className="bg-gray-500 text-white px-3 py-2 rounded hover:bg-gray-600">
                <X size={16} />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => openPaymentForSchedule(item)}
                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 flex items-center gap-1"
                title="Record this week's pickup"
              >
                <Check size={16} /> Picked Up
              </button>
              <button
                onClick={() => {
                  const nextDate = toLocalISO(getNextPickupDate(item));
                  updateSchedule(item.id, { skipped_dates: [...(item.skipped_dates || []), nextDate] });
                }}
                className="bg-orange-500 text-white px-3 py-2 rounded hover:bg-orange-600 flex items-center gap-1 text-sm"
                title="Skip next pickup"
              >
                <SkipForward size={16} /> Skip
              </button>
              {hasSkips && (
                <button
                  onClick={() => {
                    const skipped = [...(item.skipped_dates || [])].sort();
                    skipped.pop();
                    updateSchedule(item.id, { skipped_dates: skipped });
                  }}
                  className="bg-gray-400 text-white px-3 py-2 rounded hover:bg-gray-500"
                  title="Undo most recent skip"
                >
                  <RotateCcw size={16} />
                </button>
              )}
              <button onClick={() => setEditingScheduleId(item.id)} className="bg-gray-500 text-white px-3 py-2 rounded hover:bg-gray-600" title="Modify">
                <Edit2 size={16} />
              </button>
              <button onClick={() => deleteSchedule(item.id)} className="bg-red-600 text-white px-3 py-2 rounded hover:bg-red-700" title="Cancel scheduled order">
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  // ---------- Views ----------
  const Shop = () => {
    const visibleOrders = filterOrders(orders);
    const mySchedule = schedules.filter(s => s.customer_id === session?.user?.id);

    return (
      <div>
        <Notice />
        <h2 className="text-2xl font-bold mb-1">Available Products</h2>
        {!isFarmer && (
          <p className="text-sm text-gray-500 mb-4">
            Enter a quantity and tap "Reserve Now" for a one-time pickup. Each product also has a link below it to set up a recurring weekly pickup.
          </p>
        )}
        <div className="grid gap-4 mb-8">
          {products.map(product => {
            const st = getStats(product);
            const rawAvailable = getAvailableQuantity(product);
            const available = isFarmer ? rawAvailable : st.shoppable;
            const heldBack = round3(Math.max(0, rawAvailable - st.shoppable));
            const isScheduling = schedulingProduct === product.id;
            return (
              <div key={product.id} className="border rounded-lg p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="text-xl font-semibold flex items-center gap-2">
                      {product.icon && <IconByName name={product.icon} size={22} className="text-green-700" />}
                      {product.name}
                    </h3>
                    <p className="text-gray-600">{product.unit}</p>
                    {hasPrice(product) && (
                      <p className="text-green-700 font-semibold mt-1">
                        {money(priceOf(product))} <span className="text-gray-500 font-normal">/ {product.unit}</span>
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className={`text-lg font-bold ${available === 0 ? 'text-gray-400' : ''}`}>
                      {available === 0
                        ? (heldBack > 0 ? 'Fully reserved' : 'Sold out')
                        : `${available} available`}
                    </p>
                    {heldBack > 0 && (
                      <p className="text-xs text-orange-600">
                        {heldBack} held for weekly pickups
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 mt-3 flex-wrap items-center">
                  <input type="number" min="0.001" step="0.001" placeholder="Qty" className="border rounded px-3 py-2 w-28" id={`qty-${product.id}`}
                    onInput={(e) => {
                      const el = document.getElementById(`total-${product.id}`);
                      if (el) {
                        const q = parseFloat(e.target.value);
                        el.textContent = (!isNaN(q) && hasPrice(product)) ? `= ${money(priceOf(product) * q)}` : '';
                      }
                    }} />
                  {hasPrice(product) && <span id={`total-${product.id}`} className="text-sm font-semibold text-green-700"></span>}
                  {isFarmer && (
                    <select id={`for-customer-${product.id}`} className="border rounded px-3 py-2" defaultValue={session.user.id}>
                      {profiles.map(c => (
                        <option key={c.id} value={c.id}>{fullName(c)}</option>
                      ))}
                    </select>
                  )}
                  <button
                    onClick={() => {
                      const qty = parseQty(document.getElementById(`qty-${product.id}`).value);
                      const forCustomer = isFarmer
                        ? document.getElementById(`for-customer-${product.id}`).value
                        : null;
                      if (qty > 0 && qty <= available) {
                        reserveProduct(product.id, qty, forCustomer);
                        document.getElementById(`qty-${product.id}`).value = '';
                        const el = document.getElementById(`total-${product.id}`);
                        if (el) el.textContent = '';
                      } else if (qty > available) {
                        setNotice(`Only ${available} ${product.unit} of ${product.name} can be reserved right now${heldBack > 0 ? ' — the rest is held for scheduled weekly pickups' : ''}.`);
                      }
                    }}
                    disabled={available === 0}
                    className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:bg-gray-300 flex items-center gap-2"
                  >
                    <ShoppingCart size={16} /> Reserve Now
                  </button>
                </div>

                {!isFarmer && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    {!isScheduling ? (
                      <button
                        onClick={() => setSchedulingProduct(product.id)}
                        className="text-blue-700 text-sm flex items-center gap-2 hover:underline"
                      >
                        <Repeat size={16} /> Want this every week? Set up a weekly pickup
                      </button>
                    ) : (
                      <div className="bg-blue-50 border border-blue-200 rounded p-3">
                        <div className="flex justify-between items-center mb-2">
                          <p className="text-sm font-semibold text-blue-800 flex items-center gap-2">
                            <Repeat size={16} /> Weekly pickup of {product.name}
                          </p>
                          <button
                            onClick={() => setSchedulingProduct(null)}
                            className="text-blue-400 hover:text-blue-700"
                            title="Cancel"
                          >
                            <X size={16} />
                          </button>
                        </div>
                        <div className="flex gap-2 flex-wrap items-end">
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Quantity</label>
                            <input type="number" min="0.001" step="0.001" placeholder="Qty" id={`sched-qty-${product.id}`} className="border rounded px-3 py-2 w-28" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Every</label>
                            <select id={`sched-day-${product.id}`} className="border rounded px-3 py-2">
                              {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Starting (optional)</label>
                            <input type="date" id={`sched-start-${product.id}`} className="border rounded px-3 py-2" />
                          </div>
                          <button
                            onClick={() => {
                              const qty = parseQty(document.getElementById(`sched-qty-${product.id}`).value);
                              const day = document.getElementById(`sched-day-${product.id}`).value;
                              const startDate = document.getElementById(`sched-start-${product.id}`).value;
                              if (qty > 0 && day) {
                                if (st.scheduled_demand + qty > st.on_hand) {
                                  setNotice(`A weekly pickup of ${qty} ${product.unit} would exceed the current supply of ${product.name}. Try a smaller quantity, or check back when more is added.`);
                                  return;
                                }
                                addSchedule(session.user.id, product.id, qty, day, startDate);
                                setSchedulingProduct(null);
                              }
                            }}
                            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                          >
                            Confirm Weekly Pickup
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {products.length === 0 && (
            <p className="text-gray-500">No products available yet. Check back soon!</p>
          )}
        </div>

        {!isFarmer && (
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-3 flex items-center gap-2">
              <Repeat size={22} /> My Weekly Pickups
            </h2>
            <p className="text-sm text-gray-500 mb-3">
              When you pick up your order at the farm, tap "Picked Up" to log it and pay.
            </p>
            <div className="grid gap-3">
              {mySchedule.map(item => (
                <ScheduleItemCard key={item.id} item={item} showOwner={false} />
              ))}
              {mySchedule.length === 0 && (
                <p className="text-gray-500 text-sm">
                  No weekly pickups yet — use the weekly pickup link on any product above to set one up.
                </p>
              )}
            </div>
          </div>
        )}

        <div>
          <h2 className="text-2xl font-bold mb-3">{isFarmer ? 'All Orders' : 'My Orders'}</h2>
          <OrderFilterBar />
          <div className="grid gap-3">
            {visibleOrders.map(order => (
              <OrderCard key={order.id} order={order} showCustomer={isFarmer} />
            ))}
            {visibleOrders.length === 0 && (
              <p className="text-gray-500">No {orderFilter === 'all' ? '' : orderFilter + ' '}orders.</p>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Farmer-only: editable table of recent supply (last 4 weeks of batches)
  const SupplyTable = () => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - SUPPLY_TABLE_DAYS);
    const recentBatches = products
      .flatMap(p => (p.inventory_batches || []).map(b => ({
        ...b, productName: p.name, unit: p.unit
      })))
      .filter(b => new Date(b.produced_date + 'T00:00:00') >= cutoff)
      .sort((a, b) => b.produced_date.localeCompare(a.produced_date) || a.productName.localeCompare(b.productName));

    return (
      <div className="border rounded-lg p-4 mb-4">
        <h3 className="font-semibold mb-1 flex items-center gap-2">
          <Table size={18} /> Recent Supply (last {SUPPLY_TABLE_DAYS} days)
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          Edit a batch's date or quantity, or delete it. Quantity can't go below what's already reserved.
        </p>
        {recentBatches.length === 0 ? (
          <p className="text-gray-500 text-sm">No inventory added in the last {SUPPLY_TABLE_DAYS} days.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-3">Produced</th>
                  <th className="py-2 pr-3">Product</th>
                  <th className="py-2 pr-3">Quantity</th>
                  <th className="py-2 pr-3">Reserved</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recentBatches.map(b => {
                  const isEditing = editingBatchId === b.id;
                  const reserved = Number(b.reserved || 0);
                  return (
                    <tr key={b.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-3">
                        {isEditing ? (
                          <input type="date" defaultValue={b.produced_date} id={`batch-date-${b.id}`} className="border rounded px-2 py-1" />
                        ) : (
                          new Date(b.produced_date + 'T00:00:00').toLocaleDateString()
                        )}
                      </td>
                      <td className="py-2 pr-3">{b.productName}</td>
                      <td className="py-2 pr-3">
                        {isEditing ? (
                          <input type="number" min={reserved} step="0.001" defaultValue={b.quantity} id={`batch-qty-${b.id}`} className="border rounded px-2 py-1 w-28" />
                        ) : (
                          `${b.quantity} ${b.unit}`
                        )}
                      </td>
                      <td className="py-2 pr-3">{reserved}</td>
                      <td className="py-2">
                        <div className="flex gap-1">
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => {
                                  const qty = parseQty(document.getElementById(`batch-qty-${b.id}`).value);
                                  const date = document.getElementById(`batch-date-${b.id}`).value;
                                  if (qty < reserved) {
                                    setNotice(`Quantity can't be below the ${reserved} already reserved from this batch.`);
                                    return;
                                  }
                                  if (qty > 0 && date) {
                                    updateBatch(b.id, { quantity: qty, produced_date: date });
                                    setEditingBatchId(null);
                                  }
                                }}
                                className="bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700"
                              >
                                <Check size={14} />
                              </button>
                              <button onClick={() => setEditingBatchId(null)} className="bg-gray-500 text-white px-2 py-1 rounded hover:bg-gray-600">
                                <X size={14} />
                              </button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => setEditingBatchId(b.id)} className="bg-gray-500 text-white px-2 py-1 rounded hover:bg-gray-600" title="Edit batch">
                                <Edit2 size={14} />
                              </button>
                              <button
                                onClick={() => {
                                  if (reserved > 0) {
                                    setNotice('This batch has reserved inventory and can\'t be deleted. Cancel the reservations first.');
                                    return;
                                  }
                                  deleteBatch(b.id);
                                }}
                                className="bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700"
                                title="Delete batch"
                              >
                                <Trash2 size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  // Farmer-only: 7-day supply vs demand per product
  const ForecastView = () => (
    <div>
      <Notice />
      <h2 className="text-2xl font-bold mb-1">Demand Forecast — Next 7 Days</h2>
      <p className="text-sm text-gray-500 mb-4">
        Demand (claimed reservations + scheduled weekly pickups) is limited to current
        on-hand supply — inventory is always held back to cover every scheduled pickup.
        Forecasted production, based on the previous 7 days, is shown for planning only.
        You can override it per product below.
      </p>

      {products.length > 0 && Object.keys(stats).length === 0 && (
        <div className="bg-amber-50 border border-amber-300 text-amber-800 text-sm rounded px-3 py-2 mb-4 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span>
            Live supply/demand stats couldn't be loaded, so scheduled pickups are NOT
            being counted in these numbers. Make sure the product_stats SQL migration
            has been run in Supabase, then reload.
          </span>
        </div>
      )}

      <div className="grid gap-4">
        {products.map(product => {
          const st = getStats(product);
          const hasOverride = product.forecast_override !== null && product.forecast_override !== undefined;
          const grossSupply = round3(st.on_hand + st.active_reserved + st.incoming_forecast);
          const grossDemand = round3(st.active_reserved + st.scheduled_demand);
          const net = round3(grossSupply - grossDemand);
          const maxBar = Math.max(grossSupply, grossDemand, 1);
          const productSchedules = schedules.filter(s => s.product_id === product.id);

          return (
            <div key={product.id} className="border rounded-lg p-4">
              <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                <h3 className="text-xl font-semibold flex items-center gap-2">
                  {product.icon && <IconByName name={product.icon} size={22} className="text-green-700" />}
                  {product.name}
                </h3>
                <span className={`text-sm font-semibold px-3 py-1 rounded-full ${
                  net >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {net >= 0 ? `Surplus: +${net}` : `Shortfall: ${net}`} {product.unit}
                </span>
              </div>

              <div className="space-y-3 mb-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-semibold text-green-800">Supply</span>
                    <span className="text-gray-600">{grossSupply} {product.unit}</span>
                  </div>
                  <div className="h-5 bg-gray-100 rounded overflow-hidden flex">
                    <div className="bg-green-600 h-full" style={{ width: `${((st.on_hand + st.active_reserved) / maxBar) * 100}%` }} />
                    <div className="bg-green-300 h-full" style={{ width: `${(st.incoming_forecast / maxBar) * 100}%` }} />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    On hand: {round3(st.on_hand + st.active_reserved)} (of which {st.active_reserved} already claimed)
                    {' | '}Forecasted production: +{st.incoming_forecast}{hasOverride ? ' (manual)' : ''}
                  </p>
                </div>

                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-semibold text-orange-800">Demand</span>
                    <span className="text-gray-600">{grossDemand} {product.unit}</span>
                  </div>
                  <div className="h-5 bg-gray-100 rounded overflow-hidden flex">
                    <div className="bg-orange-600 h-full" style={{ width: `${(st.active_reserved / maxBar) * 100}%` }} />
                    <div className="bg-orange-300 h-full" style={{ width: `${(st.scheduled_demand / maxBar) * 100}%` }} />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Claimed (awaiting pickup): {st.active_reserved}
                    {' | '}Scheduled pickups due: {st.scheduled_demand}
                  </p>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-3 flex items-end gap-2 flex-wrap">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">
                    Weekly production forecast override ({product.unit})
                  </label>
                  <input
                    type="number" min="0" step="0.001"
                    defaultValue={hasOverride ? product.forecast_override : ''}
                    placeholder="auto"
                    id={`fc-ovr-${product.id}`}
                    className="border rounded px-3 py-2 w-32"
                  />
                </div>
                <button
                  onClick={() => {
                    const raw = document.getElementById(`fc-ovr-${product.id}`).value;
                    setForecastOverride(product.id, raw === '' ? null : parseQty(raw));
                  }}
                  className="bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700 text-sm"
                >
                  Save
                </button>
                {hasOverride && (
                  <button
                    onClick={() => setForecastOverride(product.id, null)}
                    className="bg-gray-500 text-white px-3 py-2 rounded hover:bg-gray-600 text-sm"
                    title="Return to automatic forecast"
                  >
                    Use Auto
                  </button>
                )}
                <p className="text-xs text-gray-500 basis-full">
                  {hasOverride
                    ? 'Manual forecast in effect. "Use Auto" returns to the calculation based on the last 7 days.'
                    : 'Leave blank for automatic forecasting from the last 7 days of added inventory.'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                <div className="bg-gray-50 rounded p-2">
                  <p className="text-gray-500 text-xs">Open to shop right now</p>
                  <p className="font-semibold">{st.shoppable} {product.unit}</p>
                </div>
                <div className="bg-gray-50 rounded p-2">
                  <p className="text-gray-500 text-xs">Held for weekly pickups</p>
                  <p className="font-semibold">{round3(Math.max(0, st.on_hand - st.shoppable))} {product.unit}</p>
                </div>
              </div>

              {productSchedules.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded p-3">
                  <h4 className="font-semibold text-sm text-blue-800 mb-2">
                    Scheduled Pickups ({productSchedules.length})
                  </h4>
                  <div className="space-y-1">
                    {productSchedules.map(s => (
                      <div key={s.id} className="text-sm flex justify-between">
                        <span>{fullName(s.owner)}</span>
                        <span>
                          {s.quantity} {product.unit} — next:{' '}
                          {getNextPickupDate(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {products.length === 0 && (
          <p className="text-gray-500">No products yet — add some on the Inventory tab.</p>
        )}
      </div>
    </div>
  );

  // Farmer-only: all historical sales (every completed pickup)
  const SalesView = () => {
    const [salesProduct, setSalesProduct] = useState('all');
    const allSales = orders
      .filter(o => o.status === 'completed')
      .sort((a, b) => new Date(b.picked_up_date) - new Date(a.picked_up_date));
    const sales = allSales.filter(o => salesProduct === 'all' || o.product_id === Number(salesProduct));

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const totalRevenue = round3(allSales.reduce((s, o) => s + Number(o.total_cost || 0), 0));
    const totalCollected = round3(allSales.reduce((s, o) => s + Number(o.amount_paid || 0), 0));

    const productSummaries = products.map(p => {
      const pSales = allSales.filter(o => o.product_id === p.id);
      return {
        product: p,
        totalUnits: round3(pSales.reduce((sum, o) => sum + Number(o.quantity), 0)),
        totalPickups: pSales.length,
        revenue: round3(pSales.reduce((sum, o) => sum + Number(o.total_cost || 0), 0)),
        last30Units: round3(pSales
          .filter(o => new Date(o.picked_up_date) >= thirtyDaysAgo)
          .reduce((sum, o) => sum + Number(o.quantity), 0))
      };
    }).filter(s => s.totalPickups > 0);

    return (
      <div>
        <Notice />
        <h2 className="text-2xl font-bold mb-1">Sales History</h2>
        <p className="text-sm text-gray-500 mb-4">
          Every completed pickup — one-time reservations and weekly scheduled pickups.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="border rounded-lg p-3 bg-green-50">
            <p className="text-gray-500 text-xs">Total revenue (cost of goods picked up)</p>
            <p className="text-2xl font-bold text-green-700">{money(totalRevenue)}</p>
          </div>
          <div className="border rounded-lg p-3">
            <p className="text-gray-500 text-xs">Total collected (amount paid)</p>
            <p className="text-2xl font-bold">{money(totalCollected)}</p>
            {round3(totalRevenue - totalCollected) !== 0 && (
              <p className={`text-xs ${totalCollected < totalRevenue ? 'text-red-600' : 'text-gray-500'}`}>
                {totalCollected < totalRevenue
                  ? `${money(totalRevenue - totalCollected)} outstanding`
                  : `${money(totalCollected - totalRevenue)} over`}
              </p>
            )}
          </div>
        </div>

        {productSummaries.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
            {productSummaries.map(s => (
              <div key={s.product.id} className="border rounded-lg p-3">
                <p className="font-semibold flex items-center gap-2">
                  {s.product.icon && <IconByName name={s.product.icon} size={16} className="text-green-700" />}
                  {s.product.name}
                </p>
                <p className="text-2xl font-bold text-green-700">
                  {s.totalUnits} <span className="text-sm font-normal text-gray-500">{s.product.unit}</span>
                </p>
                <p className="text-xs text-gray-500">
                  {money(s.revenue)} | {s.totalPickups} pickups | {s.last30Units} {s.product.unit} last 30d
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 mb-3">
          <Filter size={16} className="text-gray-500" />
          <select
            value={salesProduct}
            onChange={(e) => setSalesProduct(e.target.value)}
            className="border rounded px-3 py-2"
          >
            <option value="all">All products</option>
            {products.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-2">
          {sales.map(order => {
            const product = products.find(p => p.id === order.product_id);
            return (
              <div key={order.id} className="border rounded-lg p-3 flex justify-between items-center flex-wrap gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{fullName(order.customer)}</span>
                    {order.schedule_id ? (
                      <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Repeat size={10} /> Weekly pickup
                      </span>
                    ) : (
                      <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                        One-time
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 flex items-center gap-1">
                    {product?.icon && <IconByName name={product.icon} size={14} className="text-green-700" />}
                    {order.quantity} {product?.unit || ''} {product?.name || 'Product'}
                    {order.total_cost != null && ` — ${money(order.total_cost)}`}
                  </p>
                  {order.payment_method && (
                    <p className="text-xs text-gray-500">
                      Paid {money(order.amount_paid)} via {order.payment_method}
                    </p>
                  )}
                </div>
                <p className="text-sm text-gray-500">
                  {new Date(order.picked_up_date).toLocaleDateString(undefined, {
                    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
                  })}
                </p>
              </div>
            );
          })}
          {sales.length === 0 && (
            <p className="text-gray-500">No completed pickups yet.</p>
          )}
        </div>
      </div>
    );
  };

  // Farmer-only: two business reports with CSV export
  const ReportsView = () => {
    const [report, setReport] = useState('inventory');
    const prodName = (id) => products.find(p => p.id === id)?.name || 'Product';
    const prodUnit = (id) => products.find(p => p.id === id)?.unit || '';
    const outDate = (d) => d ? new Date(d).toLocaleDateString() : '—';
    const addedStr = (from, to) => {
      const fmt = (x) => x ? new Date(x + 'T00:00:00').toLocaleDateString() : null;
      const f = fmt(from), t = fmt(to);
      if (!f && !t) return '—';
      if (!t || f === t) return f || t;
      return `${f} – ${t}`;
    };

    // Report 1: inventory history — every sale and every disposition
    const inventoryRows = [
      ...orders.filter(o => o.status === 'completed').map(o => ({
        date: o.picked_up_date,
        added: addedStr(o.added_from, o.added_to),
        item: prodName(o.product_id),
        unit: prodUnit(o.product_id),
        quantity: Number(o.quantity),
        action: o.schedule_id ? 'Sale (weekly pickup)' : 'Sale',
        isSale: true,
        price: o.unit_price
      })),
      ...discards.map(d => ({
        date: d.created_at,
        added: addedStr(d.added_from || d.batch_produced_date, d.added_to || d.batch_produced_date),
        item: d.product_name,
        unit: prodUnit(d.product_id),
        quantity: Number(d.quantity),
        action: d.reason,
        isSale: false,
        price: null
      }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    // Report 2: sales history — completed orders only
    const salesRows = orders.filter(o => o.status === 'completed')
      .sort((a, b) => new Date(b.picked_up_date) - new Date(a.picked_up_date))
      .map(o => ({
        item: prodName(o.product_id),
        unit: prodUnit(o.product_id),
        quantity: Number(o.quantity),
        unitPrice: o.unit_price,
        buyer: fullName(o.customer),
        method: o.payment_method || '—',
        amountPaid: o.amount_paid,
        pickupPrice: o.total_cost,
        added: addedStr(o.added_from, o.added_to),
        sold: outDate(o.picked_up_date)
      }));

    // Totals (quantity is summed per-unit so different units never get mixed)
    const qtyByUnit = (rows) => {
      const m = {};
      rows.forEach(r => { m[r.unit] = (m[r.unit] || 0) + r.quantity; });
      const parts = Object.entries(m).map(([u, q]) => `${round3(q)}${u ? ' ' + u : ''}`);
      return parts.length ? parts.join(', ') : '—';
    };
    const invSaleCount = inventoryRows.filter(r => r.isSale).length;
    const invDispCount = inventoryRows.filter(r => !r.isSale).length;
    const invSaleValue = round3(inventoryRows.filter(r => r.isSale)
      .reduce((s, r) => s + (Number(r.price) || 0) * r.quantity, 0));
    const salesPaidTotal = round3(salesRows.reduce((s, r) => s + (Number(r.amountPaid) || 0), 0));
    const salesPickupTotal = round3(salesRows.reduce((s, r) => s + (Number(r.pickupPrice) || 0), 0));

    const exportCSV = (filename, headers, rows) => {
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
      try {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        setNotice('CSV download is blocked in this preview, but it works in the deployed app.');
      }
    };

    const exportInventory = () => exportCSV(
      'inventory-history.csv',
      ['Item type', 'Quantity', 'Sale or disposition', 'Date added', 'Date sold/disposed', 'Price at time of sale'],
      [
        ...inventoryRows.map(r => [
          r.item, `${r.quantity} ${r.unit}`, r.action,
          r.added, outDate(r.date),
          r.isSale && r.price != null ? money(r.price) : ''
        ]),
        ['TOTALS', qtyByUnit(inventoryRows), `${invSaleCount} sales, ${invDispCount} disposed`, '', '', `${money(invSaleValue)} sale value`]
      ]
    );

    const exportSales = () => exportCSV(
      'sales-history.csv',
      ['Item type', 'Quantity', 'Price of item', 'Buyer', 'Purchase method', 'Amount paid', 'Price of pickup', 'Date added', 'Date sold'],
      [
        ...salesRows.map(r => [
          r.item, `${r.quantity} ${r.unit}`,
          r.unitPrice != null ? money(r.unitPrice) : '',
          r.buyer, r.method,
          r.amountPaid != null ? money(r.amountPaid) : '',
          r.pickupPrice != null ? money(r.pickupPrice) : '',
          r.added, r.sold
        ]),
        ['TOTALS', qtyByUnit(salesRows), '', '', '', money(salesPaidTotal), money(salesPickupTotal), '', '']
      ]
    );

    return (
      <div>
        <Notice />
        <h2 className="text-2xl font-bold mb-3">Reports</h2>

        <div className="flex gap-2 mb-4 flex-wrap">
          <button
            onClick={() => setReport('inventory')}
            className={`text-sm px-4 py-2 rounded-full border ${report === 'inventory' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 hover:border-green-400'}`}
          >
            Inventory History
          </button>
          <button
            onClick={() => setReport('sales')}
            className={`text-sm px-4 py-2 rounded-full border ${report === 'sales' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 hover:border-green-400'}`}
          >
            Sales History
          </button>
        </div>

        {report === 'inventory' && (
          <div>
            <div className="flex justify-between items-center mb-2 flex-wrap gap-2">
              <p className="text-sm text-gray-500">
                Every sale and disposition (discard), newest first.
              </p>
              <button onClick={exportInventory} className="bg-gray-900 text-white px-3 py-2 rounded-full text-sm flex items-center gap-2 hover:bg-gray-700">
                <Download size={14} /> Export CSV
              </button>
            </div>
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b bg-gray-50">
                    <th className="py-2 px-3">Item type</th>
                    <th className="py-2 px-3">Quantity</th>
                    <th className="py-2 px-3">Sale / Disposition</th>
                    <th className="py-2 px-3">Date added</th>
                    <th className="py-2 px-3">Date sold / disposed</th>
                    <th className="py-2 px-3">Price at sale</th>
                  </tr>
                </thead>
                <tbody>
                  {inventoryRows.map((r, i) => (
                    <tr key={i} className="border-b last:border-b-0">
                      <td className="py-2 px-3 font-medium">{r.item}</td>
                      <td className="py-2 px-3">{r.quantity} {r.unit}</td>
                      <td className="py-2 px-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${r.isSale ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`}>
                          {r.action}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-gray-600">{r.added}</td>
                      <td className="py-2 px-3 text-gray-600">{outDate(r.date)}</td>
                      <td className="py-2 px-3">{r.isSale && r.price != null ? money(r.price) : '—'}</td>
                    </tr>
                  ))}
                  {inventoryRows.length === 0 && (
                    <tr><td colSpan="6" className="py-4 px-3 text-gray-500">No inventory movements yet.</td></tr>
                  )}
                </tbody>
                {inventoryRows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 font-semibold bg-gray-100">
                      <td className="py-2 px-3">Totals</td>
                      <td className="py-2 px-3">{qtyByUnit(inventoryRows)}</td>
                      <td className="py-2 px-3">{invSaleCount} sales, {invDispCount} disposed</td>
                      <td className="py-2 px-3"></td>
                      <td className="py-2 px-3"></td>
                      <td className="py-2 px-3">{money(invSaleValue)} <span className="font-normal text-xs text-gray-500">sale value</span></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )}

        {report === 'sales' && (
          <div>
            <div className="flex justify-between items-center mb-2 flex-wrap gap-2">
              <p className="text-sm text-gray-500">
                Every completed pickup, newest first.
              </p>
              <button onClick={exportSales} className="bg-gray-900 text-white px-3 py-2 rounded-full text-sm flex items-center gap-2 hover:bg-gray-700">
                <Download size={14} /> Export CSV
              </button>
            </div>
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b bg-gray-50">
                    <th className="py-2 px-3">Item type</th>
                    <th className="py-2 px-3">Quantity</th>
                    <th className="py-2 px-3">Price of item</th>
                    <th className="py-2 px-3">Buyer</th>
                    <th className="py-2 px-3">Purchase method</th>
                    <th className="py-2 px-3">Amount paid</th>
                    <th className="py-2 px-3">Price of pickup</th>
                    <th className="py-2 px-3">Date added</th>
                    <th className="py-2 px-3">Date sold</th>
                  </tr>
                </thead>
                <tbody>
                  {salesRows.map((r, i) => (
                    <tr key={i} className="border-b last:border-b-0">
                      <td className="py-2 px-3 font-medium">{r.item}</td>
                      <td className="py-2 px-3">{r.quantity} {r.unit}</td>
                      <td className="py-2 px-3">{r.unitPrice != null ? money(r.unitPrice) : '—'}</td>
                      <td className="py-2 px-3">{r.buyer}</td>
                      <td className="py-2 px-3">{r.method}</td>
                      <td className="py-2 px-3">{r.amountPaid != null ? money(r.amountPaid) : '—'}</td>
                      <td className="py-2 px-3 font-medium">{r.pickupPrice != null ? money(r.pickupPrice) : '—'}</td>
                      <td className="py-2 px-3 text-gray-600">{r.added}</td>
                      <td className="py-2 px-3 text-gray-600">{r.sold}</td>
                    </tr>
                  ))}
                  {salesRows.length === 0 && (
                    <tr><td colSpan="9" className="py-4 px-3 text-gray-500">No completed sales yet.</td></tr>
                  )}
                </tbody>
                {salesRows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 font-semibold bg-gray-100">
                      <td className="py-2 px-3">Totals</td>
                      <td className="py-2 px-3">{qtyByUnit(salesRows)}</td>
                      <td className="py-2 px-3"></td>
                      <td className="py-2 px-3"></td>
                      <td className="py-2 px-3"></td>
                      <td className="py-2 px-3">{money(salesPaidTotal)}</td>
                      <td className="py-2 px-3">{money(salesPickupTotal)}</td>
                      <td className="py-2 px-3"></td>
                      <td className="py-2 px-3"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  const AdminInventory = () => (
    <div>
      <Notice />
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Inventory Management</h2>
        <button
          onClick={() => setShowNewProduct(!showNewProduct)}
          className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 flex items-center gap-2"
        >
          <Plus size={16} /> New Product
        </button>
      </div>

      {showNewProduct && (
        <div className="border rounded-lg p-4 mb-4 bg-gray-50">
          <h3 className="font-semibold mb-3">Add New Product</h3>
          <div className="grid gap-3">
            <input type="text" placeholder="Product Name" id="new-product-name" className="border rounded px-3 py-2" />
            <input type="text" placeholder="Unit (e.g., gallon, dozen)" id="new-product-unit" className="border rounded px-3 py-2" />
            <input type="number" min="0" step="0.01" placeholder="Price per unit (optional)" id="new-product-price" className="border rounded px-3 py-2" />
            <p className="text-xs text-gray-500 -mt-1">You can add an icon after creating the product, using "Add icon" on its card below.</p>
            <button
              onClick={() => {
                const name = document.getElementById('new-product-name').value;
                const unit = document.getElementById('new-product-unit').value;
                const price = document.getElementById('new-product-price').value;
                if (name && unit) {
                  addProduct(name, unit, price);
                  setShowNewProduct(false);
                }
              }}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              Add Product
            </button>
          </div>
        </div>
      )}

      <SupplyTable />

      <div className="grid gap-4">
        {products.map(product => {
          const totalReserved = getTotalReserved(product);
          const pendingOrders = getPendingOrders(product.id);
          const productDiscards = discards.filter(d => d.product_id === product.id);
          const batches = [...(product.inventory_batches || [])].sort(
            (a, b) => a.produced_date.localeCompare(b.produced_date)
          );
          const discardableBatches = batches.filter(b => Number(b.quantity) - Number(b.reserved || 0) > 0);
          const isEditingIcon = editingIconId === product.id;

          return (
            <div key={product.id} className="border rounded-lg p-4">
              <h3 className="text-xl font-semibold mb-2 flex items-center gap-2">
                {product.icon && <IconByName name={product.icon} size={22} className="text-green-700" />}
                {product.name}
              </h3>

              <div className="bg-gray-50 border border-gray-200 rounded p-3 mb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-9 h-9 rounded bg-white border">
                      {product.icon
                        ? <IconByName name={product.icon} size={20} className="text-green-700" />
                        : <ImageIcon size={18} className="text-gray-300" />}
                    </span>
                    <div>
                      <p className="text-xs text-gray-600 flex items-center gap-1">
                        <ImageIcon size={12} /> Display icon
                      </p>
                      <p className="text-sm font-medium text-gray-700">{product.icon || 'None set'}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setEditingIconId(isEditingIcon ? null : product.id)}
                    className="bg-gray-700 text-white px-3 py-2 rounded hover:bg-gray-800 text-sm flex items-center gap-1"
                  >
                    {isEditingIcon ? <><X size={14} /> Close</> : <><Edit2 size={14} /> {product.icon ? 'Change icon' : 'Add icon'}</>}
                  </button>
                </div>

                {isEditingIcon && (
                  <div className="mt-3 bg-white border rounded p-3">
                    <ProductIconPicker
                      inputId={`icon-pick-${product.id}`}
                      initial={product.icon || ''}
                      seedName={product.name}
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Icons matching "{product.name}" are shown first — edit the search to find others, or clear it to browse all.
                    </p>
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => {
                          const val = document.getElementById(`icon-pick-${product.id}`).value;
                          setProductIcon(product.id, val);
                          setEditingIconId(null);
                        }}
                        className="bg-green-600 text-white px-3 py-2 rounded hover:bg-green-700 text-sm"
                      >
                        Save Icon
                      </button>
                      {product.icon && (
                        <button
                          onClick={() => { setProductIcon(product.id, null); setEditingIconId(null); }}
                          className="bg-gray-500 text-white px-3 py-2 rounded hover:bg-gray-600 text-sm"
                        >
                          Remove Icon
                        </button>
                      )}
                      <button
                        onClick={() => setEditingIconId(null)}
                        className="bg-gray-200 text-gray-700 px-3 py-2 rounded hover:bg-gray-300 text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-green-50 border border-green-200 rounded p-3 mb-3 flex items-end gap-2 flex-wrap">
                <div>
                  <label className="block text-xs text-gray-600 mb-1 flex items-center gap-1">
                    <DollarSign size={12} /> Price per {product.unit}
                  </label>
                  <input
                    type="number" min="0" step="0.01"
                    defaultValue={hasPrice(product) ? Number(product.price).toFixed(2) : ''}
                    placeholder="no price set"
                    id={`price-${product.id}`}
                    className="border rounded px-3 py-2 w-36"
                  />
                </div>
                <button
                  onClick={() => {
                    const raw = document.getElementById(`price-${product.id}`).value;
                    setProductPrice(product.id, raw);
                  }}
                  className="bg-green-600 text-white px-3 py-2 rounded hover:bg-green-700 text-sm"
                >
                  Save Price
                </button>
                {hasPrice(product) && (
                  <p className="text-xs text-gray-500 basis-full">
                    Customers see {money(priceOf(product))} per {product.unit}; pickups are billed at price × quantity.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 mb-3">
                <div>
                  <p className="text-sm text-gray-600">Unit</p>
                  <p className="font-semibold">{product.unit}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Available</p>
                  <p className="font-semibold text-green-600">{getAvailableQuantity(product)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Reserved</p>
                  <p className="font-semibold text-orange-600">{totalReserved}</p>
                </div>
              </div>

              {pendingOrders.length > 0 && (
                <div className="mb-3 bg-orange-50 border border-orange-200 rounded p-3">
                  <h4 className="font-semibold text-sm text-orange-800 mb-2">Pending Orders ({pendingOrders.length})</h4>
                  <div className="space-y-1">
                    {pendingOrders.map(order => (
                      <div key={order.id} className="text-sm flex justify-between">
                        <span>{fullName(order.customer)}</span>
                        <span className="font-semibold">{order.quantity} {product.unit}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <AddInventory
                product={product}
                animals={herdAnimals}
                split={splits[product.id]}
                setSplit={(next) => setSplits(prev => ({ ...prev, [product.id]: next }))}
                onAdd={addInventory}
              />

              <div className="bg-red-50 border border-red-200 p-3 rounded mb-3">
                <h4 className="font-semibold mb-2 flex items-center gap-2 text-red-800">
                  <AlertTriangle size={16} /> Discard Inventory
                </h4>
                <div className="flex gap-2 flex-wrap">
                  <input type="number" min="0.001" step="0.001" max={getAvailableQuantity(product)} placeholder="Quantity"
                    id={`discard-qty-${product.id}`} className="border rounded px-3 py-2 w-32" />
                  <select id={`discard-batch-${product.id}`} className="border rounded px-3 py-2" defaultValue="">
                    <option value="">From oldest batches first</option>
                    {discardableBatches.map(b => (
                      <option key={b.id} value={b.id}>
                        Batch {new Date(b.produced_date + 'T00:00:00').toLocaleDateString()} — {round3(Number(b.quantity) - Number(b.reserved || 0))} available
                      </option>
                    ))}
                  </select>
                  <select id={`discard-reason-${product.id}`} className="border rounded px-3 py-2" defaultValue="">
                    <option value="" disabled>What was done with it?</option>
                    {DISCARD_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button
                    onClick={() => {
                      const qty = parseQty(document.getElementById(`discard-qty-${product.id}`).value);
                      const reason = document.getElementById(`discard-reason-${product.id}`).value;
                      const batchRaw = document.getElementById(`discard-batch-${product.id}`).value;
                      const batchId = batchRaw === '' ? null : Number(batchRaw);
                      if (qty > 0 && reason) {
                        discardInventory(product.id, qty, reason, batchId);
                      }
                    }}
                    className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
                  >
                    Discard
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  A reason is required. Choose a specific batch, or default to oldest first. Only unreserved inventory can be discarded.
                </p>
                {productDiscards.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {productDiscards.slice(0, 5).map(d => (
                      <p key={d.id} className="text-xs text-red-700">
                        {new Date(d.created_at).toLocaleDateString()}: {d.quantity} {product.unit} — {d.reason}
                        {d.batch_produced_date && ` (batch of ${new Date(d.batch_produced_date + 'T00:00:00').toLocaleDateString()})`}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              {batches.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">Inventory Batches</h4>
                  <div className="space-y-1">
                    {batches.map(inv => (
                      <div key={inv.id} className="text-sm bg-white p-2 rounded border">
                        {new Date(inv.produced_date + 'T00:00:00').toLocaleDateString()} -
                        Qty: {inv.quantity} | Reserved: {inv.reserved || 0} |
                        Available: {round3(Number(inv.quantity) - Number(inv.reserved || 0))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const UsersView = () => (
    <div>
      <Notice />
      <h2 className="text-2xl font-bold mb-4">Registered Users</h2>

      <div className="border rounded-lg p-4 mb-4 bg-gray-50">
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <Mail size={18} /> Compose Email
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          Write your subject and message, then use "Email All Users" or the Email button next to an individual user. This opens your mail app with everything pre-filled.
        </p>
        <div className="grid gap-3">
          <input type="text" placeholder="Subject" id="email-subject" className="border rounded px-3 py-2" />
          <textarea placeholder="Message" id="email-body" rows="4" className="border rounded px-3 py-2" />
          <button
            onClick={() => composeEmail('', profiles.map(c => c.email).join(','))}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 flex items-center justify-center gap-2"
          >
            <Mail size={16} /> Email All Users ({profiles.length})
          </button>
          <p className="text-xs text-gray-500">
            All addresses are added as BCC so users can't see each other's emails.
          </p>
        </div>
      </div>

      <div className="grid gap-3">
        {profiles.map(c => {
          const userSchedules = schedules.filter(s => s.customer_id === c.id);
          return (
            <div key={c.id} className="border rounded-lg p-4 flex justify-between items-start flex-wrap gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{fullName(c)}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${c.role === 'farmer' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                    {c.role === 'farmer' ? 'Farmer' : 'Buyer'}
                  </span>
                </div>
                <p className="text-sm text-gray-600">{c.email}</p>
                <p className="text-sm text-gray-600">{formatPhone(c.phone)}</p>
                <p className="text-xs text-gray-500">
                  Registered: {c.created_at ? new Date(c.created_at).toLocaleDateString() : 'N/A'}
                </p>
                {userSchedules.length > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    Scheduled pickups: {userSchedules.map(s => `${s.quantity} ${s.product?.name || ''} (${s.day})`).join(', ')}
                  </p>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => composeEmail(c.email, null)}
                  className="bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700 flex items-center gap-2 text-sm"
                >
                  <Mail size={16} /> Email
                </button>
                {c.role === 'buyer' && (
                  <button
                    onClick={() => promoteToFarmer(c.id)}
                    className="bg-green-600 text-white px-3 py-2 rounded hover:bg-green-700 flex items-center gap-2 text-sm"
                  >
                    <ShieldCheck size={16} /> Make Farmer
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const ProfileView = () => (
    <div>
      <h2 className="text-2xl font-bold mb-4">My Profile</h2>
      {profile && (
        <div className="border rounded-lg p-4">
          <div className="grid gap-2">
            <p><strong>Name:</strong> {fullName(profile)}</p>
            <p><strong>Email:</strong> {profile.email}</p>
            <p><strong>Phone:</strong> {formatPhone(profile.phone)}</p>
            <p><strong>Role:</strong> {isFarmer ? 'Farmer' : 'Buyer'}</p>
            <p className="text-sm text-gray-500">
              Member since: {profile.created_at ? new Date(profile.created_at).toLocaleDateString() : 'N/A'}
            </p>
          </div>
        </div>
      )}
    </div>
  );

  const FarmerScheduleView = () => {
    const [selectedUserId, setSelectedUserId] = useState(session?.user?.id);

    return (
      <div>
        <Notice />
        <h2 className="text-2xl font-bold mb-4">All Scheduled Pickups</h2>

        <div className="mb-4 border rounded-lg p-4 bg-gray-50">
          <h3 className="font-semibold mb-3">Add Scheduled Pickup for a User</h3>
          <div className="grid gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">User</label>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="border rounded px-3 py-2 w-full"
              >
                {profiles.map(c => (
                  <option key={c.id} value={c.id}>{fullName(c)} ({c.role})</option>
                ))}
              </select>
            </div>
            <select id="schedule-product" className="border rounded px-3 py-2">
              <option value="">Select Product</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input type="number" min="0.001" step="0.001" placeholder="Quantity" id="schedule-qty" className="border rounded px-3 py-2" />
            <select id="schedule-day" className="border rounded px-3 py-2">
              <option value="">Select Day</option>
              {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Start date (first pickup on or after this date)</label>
              <input type="date" id="schedule-start" className="border rounded px-3 py-2 w-full" />
            </div>
            <button
              onClick={() => {
                const productId = Number(document.getElementById('schedule-product').value);
                const qty = document.getElementById('schedule-qty').value;
                const day = document.getElementById('schedule-day').value;
                const startDate = document.getElementById('schedule-start').value;
                if (productId && qty && day && selectedUserId) {
                  addSchedule(selectedUserId, productId, qty, day, startDate);
                }
              }}
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
            >
              Add to Schedule
            </button>
          </div>
        </div>

        <div className="grid gap-3">
          {schedules.map(item => (
            <ScheduleItemCard key={item.id} item={item} showOwner={true} />
          ))}
          {schedules.length === 0 && (
            <p className="text-gray-500">No scheduled pickups from any user yet.</p>
          )}
        </div>
      </div>
    );
  };

  // ---------- Setup & auth screens ----------
  const SetupScreen = () => {
    const [setupError, setSetupError] = useState('');
    const [saving, setSaving] = useState(false);

    return (
      <div className="max-w-md mx-auto mt-10 p-6 border rounded-lg shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <Database size={22} className="text-green-600" />
          <h2 className="text-2xl font-bold">Connect to Supabase</h2>
        </div>
        <p className="text-gray-500 text-sm mb-4">
          One-time setup. In your Supabase dashboard: the Project URL is under
          Settings → Data API. The key is under Settings → API Keys — use the
          Publishable key (sb_publishable_...), or the anon key from the Legacy
          API Keys tab. Never use the secret/service_role key here.
        </p>
        {setupError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2 mb-3">
            {setupError}
          </div>
        )}
        <div className="grid gap-3">
          <input type="text" placeholder="Project URL (https://xxxx.supabase.co)" id="setup-url" className="border rounded px-3 py-2" />
          <input type="text" placeholder="Anon public key" id="setup-key" className="border rounded px-3 py-2" />
          <button
            disabled={saving}
            onClick={async () => {
              setSetupError('');
              const url = document.getElementById('setup-url').value.trim().replace(/\/+$/, '');
              const key = document.getElementById('setup-key').value.trim();
              if (!url.startsWith('https://') || !key) {
                setSetupError('Please enter a valid project URL and anon key.');
                return;
              }
              setSaving(true);
              try {
                const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key } });
                if (!res.ok) throw new Error();
                const cfg = { url, key };
                await window.storage.set('farm-supabase-config', JSON.stringify(cfg), true);
                setConfig(cfg);
              } catch (e) {
                setSetupError(
                  "Couldn't connect. If the URL and key are correct, note that " +
                  "Claude's artifact preview blocks external network requests — " +
                  "this app must be deployed as a real website (e.g., Vercel or " +
                  "Netlify) to reach Supabase."
                );
              } finally {
                setSaving(false);
              }
            }}
            className="bg-green-600 text-white px-4 py-3 rounded hover:bg-green-700 disabled:bg-gray-300"
          >
            {saving ? 'Connecting...' : 'Connect'}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          The anon key is designed to be public — your data is protected by row-level security rules in the database, not by hiding this key.
        </p>
      </div>
    );
  };

  const LoginForm = () => {
    const submitLogin = () => {
      setAuthSuccess('');
      login({
        email: document.getElementById('login-email').value,
        password: document.getElementById('login-password').value
      });
    };
    const onEnter = (e) => { if (e.key === 'Enter') submitLogin(); };

    return (
      <div className="max-w-md mx-auto mt-10 p-6 border border-gray-200 rounded-2xl shadow-sm">
        <img src="/logo.png" alt="Suchomski Family Farm" className="h-48 w-auto mx-auto mb-4" />
        <div className="flex items-center gap-2 mb-1">
          <Lock size={22} className="text-cyan-500" />
          <h2 className="text-2xl font-bold tracking-tight">Sign In</h2>
        </div>
        <p className="text-gray-500 text-sm mb-4">Welcome back to Suchomski Family Farm</p>

        {authSuccess && (
          <div className="bg-cyan-50 border border-cyan-200 text-cyan-800 text-sm rounded-lg px-3 py-2 mb-3">
            {authSuccess}
          </div>
        )}
        {authError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 mb-3">
            {authError}
          </div>
        )}

        <div className="grid gap-3">
          <input type="email" placeholder="Email" id="login-email" className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500" autoComplete="email" onKeyDown={onEnter} />
          <input type="password" placeholder="Password" id="login-password" className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500" autoComplete="current-password" onKeyDown={onEnter} />
          <button
            onClick={submitLogin}
            disabled={authLoading}
            className="bg-cyan-500 text-white px-4 py-3 rounded-full font-semibold hover:bg-cyan-400 transition disabled:bg-gray-300 disabled:text-gray-500"
          >
            {authLoading ? 'Signing in...' : 'Sign In'}
          </button>
          <button
            onClick={() => { setAuthView('reset'); setAuthError(''); setAuthSuccess(''); }}
            className="text-sm text-gray-500 hover:text-cyan-600 hover:underline"
          >
            Forgot password?
          </button>
        </div>

        <p className="text-sm text-gray-600 mt-4 text-center">
          New customer?{' '}
          <button
            onClick={() => { setAuthView('register'); setAuthError(''); setAuthSuccess(''); }}
            className="text-cyan-600 font-semibold hover:underline"
          >
            Create an account
          </button>
        </p>
      </div>
    );
  };

  const RegisterForm = () => (
    <div className="max-w-md mx-auto mt-10 p-6 border border-gray-200 rounded-2xl shadow-sm">
      <img src="/logo.png" alt="Suchomski Family Farm" className="h-48 w-auto mx-auto mb-4" />
      <div className="flex items-center gap-2 mb-1">
        <User size={22} className="text-cyan-500" />
        <h2 className="text-2xl font-bold tracking-tight">Create Account</h2>
      </div>
      <p className="text-gray-500 text-sm mb-4">Join Suchomski Family Farm to reserve fresh goods</p>

      {authError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 mb-3">
          {authError}
        </div>
      )}

      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <input type="text" placeholder="First Name" id="reg-first-name" className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500" autoComplete="given-name" />
          <input type="text" placeholder="Last Name" id="reg-last-name" className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500" autoComplete="family-name" />
        </div>
        <input type="email" placeholder="Email" id="reg-email" className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500" autoComplete="email" />
        <input type="tel" placeholder="Phone" id="reg-phone" className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500" autoComplete="tel" />
        <input type="password" placeholder="Password (min 8 characters)" id="reg-password" className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500" autoComplete="new-password" />
        <input type="password" placeholder="Confirm Password" id="reg-confirm-password" className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500" autoComplete="new-password" />
        <button
          onClick={() => {
            register({
              firstName: document.getElementById('reg-first-name').value,
              lastName: document.getElementById('reg-last-name').value,
              email: document.getElementById('reg-email').value,
              phone: document.getElementById('reg-phone').value,
              password: document.getElementById('reg-password').value,
              confirmPassword: document.getElementById('reg-confirm-password').value
            });
          }}
          disabled={authLoading}
          className="bg-cyan-500 text-white px-4 py-3 rounded-full font-semibold hover:bg-cyan-400 transition disabled:bg-gray-300 disabled:text-gray-500"
        >
          {authLoading ? 'Creating account...' : 'Create Account'}
        </button>
      </div>

      <p className="text-sm text-gray-600 mt-4 text-center">
        Already have an account?{' '}
        <button
          onClick={() => { setAuthView('login'); setAuthError(''); setAuthSuccess(''); }}
          className="text-cyan-600 font-semibold hover:underline"
        >
          Sign in
        </button>
      </p>
    </div>
  );

  const ResetPasswordForm = () => (
    <div className="max-w-md mx-auto mt-10 p-6 border border-gray-200 rounded-2xl shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <Lock size={22} className="text-cyan-500" />
        <h2 className="text-2xl font-bold tracking-tight">Reset Password</h2>
      </div>
      <p className="text-gray-500 text-sm mb-4">
        Enter your email and we'll send you a password reset link.
      </p>

      {authError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 mb-3">
          {authError}
        </div>
      )}

      <div className="grid gap-3">
        <input type="email" placeholder="Email" id="reset-email" className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500" autoComplete="email"
          onKeyDown={(e) => { if (e.key === 'Enter') sendPasswordReset(document.getElementById('reset-email').value); }} />
        <button
          onClick={() => sendPasswordReset(document.getElementById('reset-email').value)}
          disabled={authLoading}
          className="bg-cyan-500 text-white px-4 py-3 rounded-full font-semibold hover:bg-cyan-400 transition disabled:bg-gray-300 disabled:text-gray-500"
        >
          {authLoading ? 'Sending...' : 'Send Reset Email'}
        </button>
      </div>

      <p className="text-sm text-gray-600 mt-4 text-center">
        Remembered it?{' '}
        <button
          onClick={() => { setAuthView('login'); setAuthError(''); setAuthSuccess(''); }}
          className="text-cyan-600 font-semibold hover:underline"
        >
          Back to sign in
        </button>
      </p>
    </div>
  );

  // ---------- Render ----------
  if (loading) {
    return (
      <div className="max-w-md mx-auto mt-20 text-center text-gray-500">
        Loading...
      </div>
    );
  }

  if (configChecked && !config) {
    return <SetupScreen />;
  }

  if (!session || !profile) {
    if (authView === 'register') return <RegisterForm />;
    if (authView === 'reset') return <ResetPasswordForm />;
    return <LoginForm />;
  }

  const TabButton = ({ id, icon: Icon, label }) => (
    <button
      onClick={() => setView(id)}
      className={`px-3 py-2 text-sm transition ${view === id ? 'border-b-2 border-cyan-500 font-semibold text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
    >
      <Icon size={16} className="inline mr-1.5" />
      {label}
    </button>
  );

  return (
    <div className="max-w-4xl mx-auto p-6 text-gray-900">
      <PaymentModal />
      <div className="mb-6 flex justify-between items-center flex-wrap gap-2">
        <img src="/logo.png" alt="Suchomski Family Farm" className="h-32 w-auto" />
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">
            {fullName(profile)}
            <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${isFarmer ? 'bg-cyan-100 text-cyan-800' : 'bg-gray-100 text-gray-700'}`}>
              {isFarmer ? 'Farmer' : 'Buyer'}
            </span>
          </span>
          <button
            onClick={logout}
            className="text-sm text-gray-600 hover:text-red-600 flex items-center gap-1 border border-gray-300 rounded-full px-3 py-1.5 hover:border-red-300 transition"
            title="Sign out"
          >
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-1 gap-y-1 mb-6 border-b border-gray-200">
        <TabButton id="shop" icon={ShoppingCart} label="Shop" />
        {isFarmer && <TabButton id="admin" icon={Package} label="Inventory" />}
        {isFarmer && <TabButton id="forecast" icon={TrendingUp} label="Forecast" />}
        {isFarmer && <TabButton id="sales" icon={Receipt} label="Sales" />}
        {isFarmer && <TabButton id="reports" icon={FileText} label="Reports" />}
        {isFarmer && <TabButton id="users" icon={Users} label="Users" />}
        {isFarmer && <TabButton id="schedule" icon={Calendar} label="Schedule" />}
        {isFarmer && (
          <a href="./FarmRealEstateTracker.html" className="px-3 py-2 text-sm text-gray-500 hover:text-gray-900 transition">
            <DollarSign size={16} className="inline mr-1.5" />Finances
          </a>
        )}
        <TabButton id="profile" icon={User} label="Profile" />
      </div>

      {view === 'shop' && <Shop />}
      {view === 'admin' && isFarmer && <AdminInventory />}
      {view === 'forecast' && isFarmer && <ForecastView />}
      {view === 'sales' && isFarmer && <SalesView />}
      {view === 'reports' && isFarmer && <ReportsView />}
      {view === 'users' && isFarmer && <UsersView />}
      {view === 'schedule' && isFarmer && <FarmerScheduleView />}
      {view === 'profile' && <ProfileView />}
    </div>
  );
};

export default FarmInventoryApp;
