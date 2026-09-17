import { createClient } from "https://esm.sh/genlayer-js@0.18.0?bundle";
import { studionet } from "https://esm.sh/genlayer-js@0.18.0/chains?bundle";

const CONTRACT_ADDRESS = "0xC30d94F19d77cA674E0B883Ef0e9112A947aB694";
const RPC_URL = "https://studio.genlayer.com/api";
const CHAIN_ID = studionet.id;
const CHAIN_HEX = `0x${Number(CHAIN_ID).toString(16)}`;
const EXPLORER = "https://explorer-studio.genlayer.com";
const ZERO = "0x0000000000000000000000000000000000000000";
const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const WALLET_KEY = "factstake.wallet";
const WALLET_RDNS_KEY = "factstake.wallet.rdns";

const NEWS_HOSTS = ["bbc.com", "reuters.com", "apnews.com", "theguardian.com", "nytimes.com"];
const SPORTS_HOSTS = ["espn.com", "skysports.com"];
const WIKI_HOSTS = ["wikipedia.org"];
const ORG_HOSTS = ["who.int", "un.org"];

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
  wallets.push({ rdns: info.rdns, name: info.name || info.rdns, provider });
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

function formButton(form) {
  return form.querySelector("button[type='submit']");
}

function setBusy(button, on) {
  if (!button) return;
  button.disabled = on;
  button.classList.toggle("loading", on);
  button.setAttribute("aria-busy", on ? "true" : "false");
}

function formatTxError(err) {
  return (
    err?.shortMessage ||
    err?.details ||
    err?.cause?.shortMessage ||
    err?.cause?.message ||
    err?.message ||
    String(err)
  );
}

function receiptLooksFailed(receipt) {
  if (!receipt || typeof receipt !== "object") return "";
  const blob = JSON.stringify(receipt).toLowerCase();
  if (
    blob.includes("nondetexception") ||
    blob.includes("traceback") ||
    blob.includes("exit_code") ||
    blob.includes("execution failed")
  ) {
    return "Resolve execution failed on-chain. Open the explorer link for the validator log.";
  }
  return "";
}

async function waitForWrite(hash) {
  if (!state.writeClient?.waitForTransactionReceipt) return null;
  try {
    return await state.writeClient.waitForTransactionReceipt({
      hash,
      retries: 60,
      interval: 3000,
    });
  } catch (err) {
    throw new Error(formatTxError(err));
  }
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

function hostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function rootDomain(host) {
  const trimmed = host.startsWith("www.") ? host.slice(4) : host;
  const parts = trimmed.split(".");
  if (parts.length >= 2) return parts.slice(-2).join(".");
  return trimmed;
}

function matchesHostList(host, list) {
  const root = rootDomain(host);
  return list.some((item) => root === item || host === item || host.endsWith("." + item));
}

function sourceFamily(url) {
  const host = hostname(url);
  if (!host) return "";
  const root = rootDomain(host);
  if (matchesHostList(host, WIKI_HOSTS)) return `wiki:${root}`;
  if (matchesHostList(host, NEWS_HOSTS)) return `news:${root}`;
  if (matchesHostList(host, SPORTS_HOSTS)) return `sports:${root}`;
  if (matchesHostList(host, ORG_HOSTS)) return `org:${root}`;
  if (host.endsWith(".europa.eu") || root === "europa.eu") return "gov:eu";
  if (host.endsWith(".gov.uk")) return "gov:uk";
  if (host.endsWith(".gouv.fr")) return "gov:fr";
  if (host.endsWith(".gob.mx")) return "gov:mx";
  if (host.endsWith(".gc.ca")) return "gov:ca";
  if (host.endsWith(".gov")) return "gov:us";
  if (host.endsWith(".int")) return "org:int";
  return "";
}

function familyKind(family) {
  return family.split(":")[0] || "";
}

function createFormErrors() {
  const claim = $("claim").value.trim();
  const eventDate = $("event-date").value.trim();
  const urlA = $("url-a").value.trim();
  const urlB = $("url-b").value.trim();
  const stake = $("stake").value.trim();
  const errors = [];

  if (claim && claim.length < 12) errors.push("Claim must be at least 12 characters.");
  if (eventDate && !DATE_RE.test(eventDate)) errors.push("Event date must be YYYY-MM-DD.");
  if (stake) {
    try {
      parseGen(stake);
    } catch (err) {
      errors.push(err.message);
    }
  }

  const urls = [
    ["Official source A", urlA],
    ["Official source B", urlB],
  ];
  const families = [];
  const roots = [];
  for (const [label, url] of urls) {
    if (!url) continue;
    if (!url.toLowerCase().startsWith("https://")) {
      errors.push(`${label} must be an https URL.`);
      continue;
    }
    const family = sourceFamily(url);
    if (!family) {
      errors.push(`${label} is not on the allowlist (news, sports, wiki, gov, org).`);
      continue;
    }
    families.push(family);
    roots.push(rootDomain(hostname(url)));
  }

  if (urlA && urlB && families.length === 2) {
    if (roots[0] === roots[1]) {
      errors.push("Sources must come from two different organizations.");
    } else if (familyKind(families[0]) === familyKind(families[1])) {
      errors.push(
        `Both sources are ${familyKind(families[0])}. Use two families, e.g. Wikipedia + BBC, not BBC + Reuters.`
      );
    }
  }

  if (!claim || !eventDate || !urlA || !urlB || !stake) {
    errors.push("Fill claim, date, both sources, and stake.");
  }
  return errors;
}

function syncCreateButton() {
  const btn = formButton($("create-form"));
  const hint = $("create-hint");
  const errors = createFormErrors();
  const blocking = errors.filter((msg) => msg !== "Fill claim, date, both sources, and stake.");
  const incomplete = errors.includes("Fill claim, date, both sources, and stake.");
  const locked = errors.length > 0;
  if (btn && !btn.classList.contains("loading")) btn.disabled = locked;
  if (hint) {
    if (blocking.length) {
      hint.hidden = false;
      hint.textContent = blocking[0];
    } else if (incomplete) {
      hint.hidden = false;
      hint.textContent = "Lock stays disabled until the form is complete and the two sources are independent families.";
    } else {
      hint.hidden = true;
      hint.textContent = "";
    }
  }
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
  if (Number.parseInt(String(current), 16) !== Number(CHAIN_ID)) {
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
  const account = state.account || ZERO;
  return state.readClient.readContract({
    address: CONTRACT_ADDRESS,
    functionName: method,
    args,
    stateStatus: "accepted",
    account,
  });
}

async function sendWrite(functionName, args, value = 0n) {
  if (!state.account) throw new Error("Connect a wallet first.");
  const provider = state.provider || window.ethereum;
  if (!provider) throw new Error("No injected wallet found.");
  state.writeClient = createClient({
    chain: studionet,
    account: state.account,
    provider,
  });
  try {
    return await state.writeClient.writeContract({
      address: CONTRACT_ADDRESS,
      functionName,
      args,
      value,
    });
  } catch (err) {
    throw new Error(formatTxError(err));
  }
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
    connectWallet(accounts[0]).catch((err) => setStatus(formatTxError(err), "err"));
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

["claim", "event-date", "url-a", "url-b", "stake"].forEach((id) => {
  $(id)?.addEventListener("input", syncCreateButton);
  $(id)?.addEventListener("change", syncCreateButton);
});

$("connect-btn").addEventListener("click", async () => {
  try {
    await connectWallet();
    await refreshStats();
  } catch (err) {
    setStatus(formatTxError(err), "err");
  }
});

$("disconnect-btn").addEventListener("click", () => {
  disconnectWallet();
});

$("create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const btn = formButton(event.currentTarget);
  const errors = createFormErrors();
  if (errors.length) {
    setStatus(errors[0], "err");
    syncCreateButton();
    return;
  }
  try {
    setBusy(btn, true);
    if (!state.account) await connectWallet();
    const hash = await sendWrite(
      "create_attestation",
      [
        $("claim").value.trim(),
        $("event-date").value.trim(),
        $("url-a").value.trim(),
        $("url-b").value.trim(),
      ],
      parseGen($("stake").value)
    );
    showTx(hash);
    setStatus("Submitted. Wait for Accepted, then inspect the new ID.", "ok");
    await waitForWrite(hash);
    await refreshStats();
  } catch (err) {
    setStatus(formatTxError(err), "err");
  } finally {
    setBusy(btn, false);
    syncCreateButton();
  }
});

$("resolve-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const btn = formButton(event.currentTarget);
  try {
    setBusy(btn, true);
    if (!state.account) await connectWallet();
    const id = $("resolve-id").value.trim();
    if (!id) throw new Error("Attestation ID is required.");
    setStatus("Submitting resolve… validators will fetch both pages.");
    const hash = await sendWrite("resolve", [id], 0n);
    showTx(hash);
    setStatus("Waiting for validators. A blocked source degrades to UNKNOWN instead of crashing.");
    const receipt = await waitForWrite(hash);
    const fail = receiptLooksFailed(receipt);
    if (fail) throw new Error(fail);
    try {
      const parsed = parseMaybeJson(await read("get_attestation", [id]));
      const status = parsed.status || "?";
      const verdict = parsed.verdict || "?";
      const ok = status === "ATTESTED" || status === "REJECTED";
      setStatus(`Resolve finished. status=${status} verdict=${verdict}`, ok ? "ok" : "");
    } catch {
      setStatus("Resolve submitted. Inspect the ID after the tx is Accepted.", "ok");
    }
    await refreshStats();
  } catch (err) {
    setStatus(formatTxError(err), "err");
  } finally {
    setBusy(btn, false);
  }
});

$("lookup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const btn = formButton(event.currentTarget);
  const out = $("lookup-out");
  const id = $("lookup-id").value.trim();
  try {
    setBusy(btn, true);
    if (!id) throw new Error("Attestation ID is required.");
    out.classList.remove("empty");
    out.textContent = "Reading…";
    const parsed = parseMaybeJson(await read("get_attestation", [id]));
    out.textContent = JSON.stringify(parsed, null, 2);
    setStatus(`Loaded attestation ${id}.`, "ok");
  } catch (err) {
    out.textContent = formatTxError(err);
    setStatus(formatTxError(err), "err");
  } finally {
    setBusy(btn, false);
  }
});

syncCreateButton();
restoreWallet();