# ATLAST — getting it live safely, and whether it could be a business

Two separate questions. The first has a clean answer. The second has an honest one.

---

# Part 1 · Deploying privately

## The thing worth knowing first

**GitHub Pro would not make this private.** Pro ($4/mo) lets you *build* Pages from a private
repo, but [the published site is still public by
default](https://github.com/orgs/community/discussions/167331) — restricting the site itself to
authorised users needs **Enterprise Cloud** with Pages access control. Paying $4 buys you a
private *source* and a public *site*, which is the opposite of what you want.

So GitHub Pages is the wrong tool for a private deploy, at any price you'd sensibly pay.

## The options, safest first

### Option A · Stay local — zero exposure
`./serve.sh` and your LAN. Nothing leaves the house, your phone still works over wifi, and
there is no attack surface, no terms of service and no third party holding anything.

**Cost:** nothing. **Trade-off:** no sharing, nothing to show anyone, and I still cannot see it
to verify it.

### Option B · Cloudflare Pages + Cloudflare Access — the recommendation
Cloudflare Pages [supports private GitHub
repos](https://developers.cloudflare.com/pages/get-started/git-integration/) on the free tier,
and **Cloudflare Access is free for up to 50 users** — a real authentication gate, not a shared
password. You log in with an email one-time code; nobody else gets in.

This gives you: a real URL, private, free, your repo stays private, and a genuine login rather
than security-by-obscurity. It also solves the `atlast` repo being disabled, because Cloudflare
does not care what GitHub thinks of the repo name.

```bash
# 1 — commit first. Nothing is safe until it is in git.
cd ~/dd/travel
git add -A
git commit -m "atlast r9.1: places index, progress and badges, capture, 188 places, 55 routes"

# 2 — a PRIVATE repo under a clean name
git remote remove origin
gh repo create vanessamadison/atlast-map --private --source=. --remote=origin --push
```

Then, in the Cloudflare dashboard (no CLI needed, and it is genuinely about four clicks):

1. **Workers & Pages → Create → Pages → Connect to Git**, authorise the Cloudflare GitHub app
   for `atlast-map` only
2. Framework preset **None**, build command **blank**, output directory **`/`** — it is static
   files, there is nothing to build
3. Deploy. You get `atlast-map.pages.dev`
4. **Zero Trust → Access → Applications → Add a self-hosted application**, hostname
   `atlast-map.pages.dev`, policy **Allow → Emails →** your address

Anyone hitting the URL now gets an email-code login wall. Add my access later if you want me to
look at it, or just screenshot.

### Option C · Public, as originally planned
Free, simplest, and the one thing to be clear-eyed about: your home town, the 54 Colorado towns
and your route history go on the open internet. Nothing sensitive by design — but it is a real
decision and worth making deliberately rather than by default.

## Recommendation

**Option B.** It costs nothing, keeps the repo private, puts a real login in front of it, and
sidesteps the disabled-repo problem entirely. Go public later if and when the product is
something you want found.

---

# Part 2 · Could this be a business?

Here is the honest read rather than the encouraging one.

## What is genuinely in your favour

**The market is in open revolt against subscriptions, right now.** This is not a guess, it is
what the research found: Gaia roughly doubled to ~$59.90/yr and got a backlash thread on its own
support site. Komoot was acquired and expanded paywalls after laying off ~85% of its dev team.
Trailforks fenced off user-contributed data. AllTrails added a $79.99 tier. FATMAP — the best 3D
terrain product ever built — was switched off entirely. Polarsteps moved 3D behind Plus and got
punished in reviews.

**Every one of those is an argument for the thing you already have:** a file you own, no account,
no subscription, and a promise that a pricing decision somewhere else cannot delete your decade
of travel. That is not a feature list, it is a position — and it is currently unoccupied.

**You also have a real wedge** in the loop (log feeds planning), provenance (surveyed vs
editorial vs inferred), and difficulty as a 2D space rather than an easy/moderate/hard label
that is the single most-criticised feature in the category.

## What is against you, plainly

**Distribution, not product.** You will not out-market AllTrails. The category's customer
acquisition runs through app-store search, SEO on trail names, and a decade of brand. A better
product does not fix that, and it is the reason most good outdoor apps you have never heard of
stayed that way.

**Content is a treadmill.** 188 places is a demo. AllTrails has ~400,000 trails. Staying current
on permits, closures and conditions is the actual job, and the research showed it is where every
incumbent fails — HiiKER refreshes quarterly, Mountain Project has banners still dated 2023.
Freshness plus authority is unsolved because it is expensive, not because nobody thought of it.

**Your time is already committed.** You are an SE1 six months in, running a cert sprint, pushing
for SE2 and Rookie of the Year. A real product is not a weekend; it is the thing you do instead
of the other thing. That is a genuine trade and it deserves naming, not glossing.

**There may be an employment question.** Datadog, like most tech employers, has an IP and
outside-activity policy. Before any money changes hands, that is a conversation with HR or
employment counsel — not something to find out afterwards. I am not qualified to advise on it
and would not try.

## The three realistic paths, ranked

### 1 · The printed artifact — best risk-adjusted return
**Polarsteps' actual business is photo books**, not the app. The app is the funnel.

A printed ATLAST poster — your terrain, your routes, your filled grid cells, your coverage — is
high margin, needs no subscription, has almost no support burden, and is the thing people put on
a wall and get asked about. Print-on-demand (Gelato, Printful) means no inventory and no capital.

Critically: **it works at any scale.** Ten posters is a nice month. It does not require winning
a category.

**Effort:** Phase 9 of the roadmap, one session for a print-quality export.
**Revenue shape:** $40–80 per poster, maybe 60–70% margin print-on-demand.

### 2 · Niche-first, one-time licence
Do not launch "a travel app". Launch **the Colorado fourteener tool** — a real, identifiable,
passionate community with existing finisher culture, registers and vocabulary. You are in it.
You know what it needs. Your data is already deepest there.

Price it once, not monthly. The subscription revolt is your opening, and "buy it once, own your
file" is contrarian positioning with demonstrated demand.

Honest caveat: **14ers.com is free, beloved, has the best risk model in the category and a
mobile app.** You complement it or you lose. The opening is the loop and the planning — what
should I do next given what I have done — which 14ers.com does not do.

**Effort:** Phases 1–4 plus polish. **Revenue shape:** $15–30 one-time, small but real.

### 3 · Freemium with the promise intact
Free forever core — FindPenguins proves this is viable and the research was blunt that a
paywalled core is dead on arrival. Charge for the things with real marginal cost: permit
availability, weather windows, print exports.

**This is the only path with meaningful upside, and the only one that becomes a job.** Support,
hosting, content freshness, and a churn number you now have to care about.

## What I would actually do

**Treat it as a beloved tool first and a business second, in that order, deliberately.**

1. **Finish Phases 1–2.** Get it rendering and prove the loop works, for yourself. If the loop
   does not change how you plan your own trips, there is no business here and you will have
   learned that cheaply.
2. **Use it for a season.** A product you do not use yourself cannot be sold honestly. Novelty
   decays by week six — if you are still opening it in November, that is the real signal.
3. **Ship the poster.** It is the lowest-risk revenue in the plan, it does not require users,
   and it is genuinely lovely.
4. **Only then** decide about the fourteener niche, and only after the employment question is
   answered.

**What I would not do:** incorporate, build billing, write a landing page, or tell anyone it is
a business until step 2 is done. The failure mode for a project this good is spending the
enthusiasm on company-shaped work instead of on the product.

The honest expected outcome: **a tool you love, that a few hundred people in a niche love, and
that makes poster money.** That is a genuinely good outcome and a bad pitch deck. If it turns
into more, it will be because step 2 went unusually well — and you will be able to tell.
