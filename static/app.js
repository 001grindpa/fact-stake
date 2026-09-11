import { createClient } from "https://esm.sh/genlayer-js@0.18.0?bundle";
import { studionet } from "https://esm.sh/genlayer-js@0.18.0/chains?bundle";

const CONTRACT_ADDRESS = "0x65B4e18C0483937d71A4745bF0aA75e948229F5d";
const RPC_URL = "https://studio.genlayer.com/api";
const CHAIN_ID = studionet.id;
const CHAIN_HEX = `0x${Number(CHAIN_ID).toString(16)}`;
const EXPLORER = "https://explorer-studio.genlayer.com";
const ZERO = "0x0000000000000000000000000000000000000000";
const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const WALLET_KEY = "factstake.wallet";
const WALLET_RDNS_KEY = "factstake.wallet.rdns";

const state = {
  account: null,
  provider: null,
  readClient: createClient({ chain: studionet, endpoint: RPC_URL, account: ZERO }),
  writeClient: null,
};

const wallets = [];

window.addEventListener("eip6963:announceProvider", (event) => {
  const { info, provider } = event.detail || {};
  if (!provider || !info?.rdns) return;
  if (wallets.some((w) => w.rdns === info.rdns)) return;
  wallets.push({
    rdns: info.rdns,
    name: info.name || info.rdns,
    provider,
  });
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

const $ = (id) => document.getElementById(id);

function setStatus(msg, kind = "") {
  const el = $("status-msg");
  el.textContent = msg;
  el.style.color = kind === "err" ? "var(--danger)" : kind === "ok" ? "var(--ok)" : "var(--mute)";
}

function showTx(hash) {
  const a = $("tx-link");
  a.href = `${EXPLORER}/tx/${hash}`;
  a.textContent = hash;
  a.classList.remove("hidden");
}

function parseGen(value) {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(normalized) || Number(normalized) <= 0) {
    throw new Error("Stake must be a positive GEN amount with up to 18 decimals.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 1000000000000000000n + BigInt(fraction.padEnd(18, "0"));
}

function formatGen(raw) {
  try {
    const n = BigInt(String(raw));
    const whole = n / 1000000000000000000n;
    const frac = (n % 1000000000000000000n).toString().padStart(18, "0").replace(/0+$/, "");
    return frac ? `${whole}.${frac} GEN` : `${whole} GEN`;
  } catch {
    return String(raw);
  }
}

function parseMaybeJson(value) {
  if (value && typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return { raw: value };
    }
  }
  return { raw: value };
}

function setConnectedUi(account) {
  $("net-pill").textContent = `${account.slice(0, 6)}…${account.slice(-4)}`;
  $("net-pill").classList.add("on");
  $("connect-btn").classList.add("hidden");
  $("disconnect-btn").classList.remove("hidden");
}

function setDisconnectedUi() {
  $("net-pill").textContent = "Disconnected";
  $("net-pill").classList.remove("on");
  $("connect-btn").classList.remove("hidden");
  $("connect-btn").textContent = "Connect wallet";
  $("disconnect-btn").classList.add("hidden");
}

function persistWallet(account) {
  localStorage.setItem(WALLET_KEY, account);
}

function clearWallet() {
  localStorage.removeItem(WALLET_KEY);
  localStorage.removeItem(WALLET_RDNS_KEY);
}

function savedWallet() {
  return localStorage.getItem(WALLET_KEY);
}

function injectedProviders() {
  const list = [...wallets];
  if (window.okxwallet && !list.some((w) => w.provider === window.okxwallet)) {
    list.push({ rdns: "com.okex.wallet", name: "OKX Wallet", provider: window.okxwallet });
  }
  if (window.ethereum && !list.some((w) => w.provider === window.ethereum)) {
    list.push({
      rdns: window.ethereum.isOkxWallet || window.ethereum.isOKXWallet ? "com.okex.wallet" : "injected",
      name: window.ethereum.isOkxWallet || window.ethereum.isOKXWallet ? "OKX Wallet" : "Injected",
      provider: window.ethereum,
    });
  }
  return list;
}

function pickProvider(preferredRdns) {
  const list = injectedProviders();
  if (!list.length) throw new Error("No injected wallet found. Install MetaMask or OKX Wallet.");
  if (preferredRdns) {
    const match = list.find((w) => w.rdns === preferredRdns);
    if (match) return match;
  }
  const okx = list.find((w) => /okx|okex/i.test(`${w.rdns} ${w.name}`));
  const metamask = list.find((w) => /metamask/i.test(`${w.rdns} ${w.name}`));
  return metamask || okx || list[0];
}

async function ensureNetwork(provider) {
  const injected = provider || state.provider || window.ethereum;
  if (!injected) throw new Error("No injected wallet found.");
  const current = await injected.request({ method: "eth_chainId" });
  if (Number.parseInt(String(current), 16) !== CHAIN_ID) {
    try {
      await injected.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_HEX }],
      });
    } catch (error) {
      const code = error?.code ?? error?.data?.originalError?.code ?? error?.error?.code;
      if (code === 4902) {
        await injected.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: CHAIN_HEX,
              chainName: "GenLayer Studionet",
              nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
              rpcUrls: [RPC_URL],
              blockExplorerUrls: [EXPLORER],
            },
          ],
        });
      } else {
        throw error;
      }
    }
  }
}

async function read(method, args = []) {
  return state.readClient.readContract({
    address: CONTRACT_ADDRESS,
    functionName: method,
    args,
    stateStatus: "accepted",
    account: state.account || ZERO,
  });
}

async function write(functionName, args, value = 0n) {
  if (!state.writeClient || !state.account) throw new Error("Connect a wallet first.");
  return state.writeContract
    ? state.writeContract
    : state.writeClient.writeContract({
        address: CONTRACT_ADDRESS,
        functionName,
        args,
        value,
        account: state.account,
      });
}

async function sendWrite(functionName, args, value = 0n) {
  if (!state.writeClient || !state.account) throw new Error("Connect a wallet first.");
  return state.writeClient.writeContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
    value,
    account: state.account,
  });
}

async function refreshStats() {
  try {
    const [count, reserved, retained] = await Promise.all([
      read("get_attestation_count"),
      read("get_reserved_stakes"),
      read("get_retained_stakes"),
    ]);
    $("stat-count").textContent = String(count ?? "0");
    $("stat-reserved").textContent = formatGen(reserved ?? 0);
    $("stat-retained").textContent = formatGen(retained ?? 0);
  } catch {
    $("stat-count").textContent = "—";
    $("stat-reserved").textContent = "—";
    $("stat-retained").textContent = "—";
  }
}

function bindProviderEvents(provider) {
  if (!provider?.on) return;
  provider.on("accountsChanged", (accounts) => {
    if (!accounts?.length) {
      disconnectWallet();
      return;
    }
    connectWallet(accounts[0]).catch((err) => setStatus(err.message || String(err), "err"));
  });
}

async function connectWallet(preferredAccount, preferredRdns) {
  const selected = pickProvider(preferredRdns || localStorage.getItem(WALLET_RDNS_KEY));
  const provider = selected.provider;
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts?.length) throw new Error("No account returned.");
  const account =
    preferredAccount && accounts.some((a) => a.toLowerCase() === preferredAccount.toLowerCase())
      ? accounts.find((a) => a.toLowerCase() === preferredAccount.toLowerCase())
      : accounts[0];
  await ensureNetwork(provider);
  state.account = account;
  state.provider = provider;
  state.writeClient = createClient({
    chain: studionet,
    account: state.account,
    provider,
  });
  if (typeof state.writeClient.connect === "function") {
    try {
      await state.writeClient.connect("studionet");
    } catch {}
  }
  persistWallet(state.account);
  localStorage.setItem(WALLET_RDNS_KEY, selected.rdns);
  bindProviderEvents(provider);
  setConnectedUi(state.account);
  setStatus(`Connected with ${selected.name} on StudioNet.`, "ok");
}

function disconnectWallet() {
  state.account = null;
  state.writeClient = null;
  state.provider = null;
  clearWallet();
  setDisconnectedUi();
  setStatus("Disconnected. Connect a wallet on StudioNet to write.");
}

async function restoreWallet() {
  const stored = savedWallet();
  if (!stored) {
    await refreshStats();
    return;
  }
  try {
    const selected = pickProvider(localStorage.getItem(WALLET_RDNS_KEY));
    const silent = await selected.provider.request({ method: "eth_accounts" });
    if (!silent?.length) {
      setDisconnectedUi();
      await refreshStats();
      return;
    }
    await connectWallet(stored, selected.rdns);
  } catch {
    setDisconnectedUi();
  }
  await refreshStats();
}

$("connect-btn").addEventListener("click", async () => {
  try {
    await connectWallet();
    await refreshStats();
  } catch (err) {
    setStatus(err.message || String(err), "err");
  }
});

$("disconnect-btn").addEventListener("click", () => {
  disconnectWallet();
});

$("create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    if (!state.account) await connectWallet();
    const claim = $("claim").value.trim();
    const eventDate = $("event-date").value.trim();
    const urlA = $("url-a").value.trim();
    const urlB = $("url-b").value.trim();
    if (claim.length < 12) throw new Error("Claim must be at least 12 characters.");
    if (!DATE_RE.test(eventDate)) throw new Error("Event date must be YYYY-MM-DD.");
    const value = parseGen($("stake").value);
    setStatus("Submitting create_attestation…");
    const hash = await sendWrite("create_attestation", [claim, eventDate, urlA, urlB], value);
    showTx(hash);
    setStatus("Attestation submitted. Check the explorer, then lookup the next ID.", "ok");
    await refreshStats();
  } catch (err) {
    setStatus(err.message || String(err), "err");
  }
});

$("resolve-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    if (!state.account) await connectWallet();
    const id = $("resolve-id").value.trim();
    if (!id) throw new Error("Attestation ID is required.");
    setStatus("Submitting resolve… validators will fetch both pages.");
    const hash = await sendWrite("resolve", [id], 0n);
    showTx(hash);
    setStatus("Resolve submitted.", "ok");
  } catch (err) {
    setStatus(err.message || String(err), "err");
  }
});

$("lookup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const out = $("lookup-out");
  try {
    const id = $("lookup-id").value.trim();
    const raw = await read("get_attestation", [id]);
    const parsed = parseMaybeJson(raw);
    out.classList.remove("empty");
    out.textContent = JSON.stringify(parsed, null, 2);
    setStatus(`Loaded attestation ${id}.`, "ok");
  } catch (err) {
    out.classList.add("empty");
    out.textContent = "No attestation loaded.";
    setStatus(err.message || String(err), "err");
  }
});

restoreWallet();