# Fact Stake

Fact Stake is a GenLayer StudioNet application for creating economically backed attestations about dated public facts. A user locks GEN against a claim and supplies two independent official sources. GenLayer validators inspect both pages and determine whether they support the claim.

- If both sources support the claim, the attestation becomes `ATTESTED` and the stake is returned.
- If both sources clearly contradict the claim, it becomes `REJECTED` and the stake is retained by the contract.
- If either source is undated, unrelated, inconclusive, or disagrees with the other, the result remains unresolved rather than being forced into a yes/no answer.

The project is intended to make public claims more accountable: a claim is tied to a date, evidence, and a financial commitment, while the final result is recorded on-chain.

## Why it matters

Public information is often difficult to verify after the fact. Screenshots can disappear, sources can conflict, and unsupported claims can spread without any cost to the person making them. Fact Stake provides a simple evidence and incentive layer:

1. The claim and its event date are permanently associated with two source URLs.
2. The stake signals that the attester is willing to put value behind the claim.
3. Multiple official pages are checked instead of relying on one page or one manually entered result.
4. The outcome and the disposition of the funds can be inspected from the contract.

This is an attestation mechanism, not a general-purpose truth oracle. The quality of the result depends on the selected sources and the information those pages contain.

## Using the app

### Requirements

- A browser with an injected EIP-1193 wallet, such as MetaMask.
- GEN on GenLayer StudioNet.
- Two HTTPS pages from different official hosts that cover the same dated event.

### Create an attestation

1. Open the app and select **Connect wallet**.
2. Approve the wallet connection and switch to, or add, GenLayer StudioNet when prompted.
3. Enter a specific claim of at least 12 characters.
4. Enter the event date in `YYYY-MM-DD` format.
5. Provide two official source URLs and a positive GEN stake.
6. Select **Lock attestation** and confirm the transaction.

The contract accepts only HTTPS URLs from its configured official-source allowlist, including recognised news, government, international-organisation, sports, and reference domains. The two URLs must resolve to different hosts. The new attestation receives a numeric ID, starting at `1`.

### Resolve and inspect

Anyone can enter an attestation ID and select **Resolve**. Validators render both source pages as text and evaluate, for each page, whether:

- it concerns the requested calendar date;
- it is related to the claim; and
- it clearly answers `YES`, `NO`, or `UNKNOWN`.

Use **Lookup** to read the stored claim, date, URLs, status, verdict, attester, stake, and funds disposition. The activity area links to the submitted transaction in the StudioNet explorer.

## Attestation lifecycle

| Status | Meaning | Funds |
| --- | --- | --- |
| `OPEN` | Created but not conclusively resolved | Reserved by the contract |
| `ATTESTED` | Both valid sources support the claim | Returned to the attester |
| `REJECTED` | Both valid sources contradict the claim | Retained by the contract |
| `CANCELLED` | Cancelled by the original attester while open | Refunded to the attester |

An open attestation can also produce a `UNKNOWN` or `DISAGREE` verdict. In that case it remains open and its stake remains reserved. The original attester may update the two sources or cancel the attestation through the contract methods. The current web interface exposes creation, resolution, and lookup; source updates and cancellation are available in the contract but are not currently represented as forms in the UI.

## Network and deployment

The current frontend is configured for:

- **Network:** GenLayer StudioNet
- **Chain ID:** `61999` (`0xf22f`)
- **RPC:** `https://studio.genlayer.com/api`
- **Contract:** `0x65B4e18C0483937d71A4745bF0aA75e948229F5d`
- **Explorer:** [StudioNet contract](https://explorer-studio.genlayer.com/address/0x65B4e18C0483937d71A4745bF0aA75e948229F5d)

The contract source is [src/AttestLock.py](src/AttestLock.py). The browser client is [static/app.js](static/app.js), and the page entry point is [index.html](index.html).

## Running locally

This repository is a static frontend with no build step or package manifest. Serve the repository directory with any local HTTP server so that the ES module and wallet integration load correctly. For example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser with the wallet extension installed. A wallet is needed for creating and resolving attestations; the app can still attempt to load public contract statistics without one.

## Contract behaviour and safeguards

- Stakes are payable in GEN and must be greater than zero.
- Claims must be dated using the exact `YYYY-MM-DD` format.
- Source URLs must use HTTPS and pass the contract's official-host validation.
- A source is treated as inconclusive when it is not about the requested date or claim.
- A single page cannot decide the result: both pages must be valid and return the same conclusive answer.
- Resolution is performed through GenLayer's nondeterministic web rendering and prompt execution, with strict equality used to agree on the adjudication result.
- Once an attestation is resolved or cancelled, it cannot be resolved again.

Use sources that are stable, authoritative, and directly relevant to the exact event date. Do not stake funds that you cannot afford to lock or lose. The deployed contract and allowlist should be reviewed before using the application with real value.
