# Company Query Review — 57 flagged names

> **Task P2.4** · review gate before `data/companies.json` is committed

> **Instructions:** leave a row untouched to approve it. To change one, edit the `Query` or `Negatives` line in place and add `EDITED` to the `Approve` line.

> Queries use a portable form — the query builder (P3.4) translates per provider.


**25 CRITICAL · 32 HIGH · 201 unflagged (auto-approved)**


---

## CRITICAL (25)

_A bare-name query returns almost entirely irrelevant news. Unusable without qualifiers._


### 47. Air EV
- **Risk:** Generic phrase; also the Wuling Air EV production car.
- **Query:** `"Air EV" AND (Israeli OR startup OR funding)`
- **Negatives:** `Wuling, "air conditioning", Tesla`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 191. Astra
- **Risk:** Vauxhall Astra, AstraZeneca, Astra Space, Astra rocket.
- **Query:** `"Astra" AND (startup OR funding OR Israeli OR technology)`
- **Negatives:** `AstraZeneca, Vauxhall, Opel, "Astra Space", rocket, satellite`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 33. Bites
- **Risk:** Matches food writing, dog bites, sound bites, insect bites.
- **Query:** `"Bites" AND ("employee training" OR "microlearning" OR "Bites app")`
- **Negatives:** `restaurant, recipe, "dog bites", snake, mosquito`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 223. CB4
- **Risk:** Short alphanumeric token; matches identifiers and the 1993 film.
- **Query:** `"CB4" AND (retail OR analytics OR startup OR funding)`
- **Negatives:** `movie, film, "CB4 the movie"`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 222. Casper
- **Risk:** Casper mattress (large, newsworthy), Casper the ghost, Casper Network (crypto).
- **Query:** `"Casper" AND (startup OR funding OR Israeli OR technology)`
- **Negatives:** `mattress, ghost, "Casper Network", Wyoming, crypto`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 119. Greenlight
- **Risk:** 'Greenlit a project', Greenlight Capital, Greenlight Networks.
- **Query:** `"Greenlight" AND ("kids debit" OR "family finance" OR fintech)`
- **Negatives:** `"green light", "greenlit", "Greenlight Capital", traffic`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 88. Guild
- **Risk:** Gaming guilds, trade guilds, Guild Education, Writers Guild.
- **Query:** `"Guild" AND (startup OR funding OR platform) `
- **Negatives:** `"Writers Guild", "Screen Actors", gaming guild, "guild wars"`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 6. Harvey
- **Risk:** Collides with Hurricane Harvey, Harvey Weinstein, Harvey Norman, and every person named Harvey.
- **Query:** `"Harvey AI" OR ("Harvey" AND ("legal AI" OR "law firm" OR "legal tech"))`
- **Negatives:** `hurricane, Weinstein, "Harvey Norman", Harvey Keitel`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 19. Island
- **Risk:** Extremely common noun; unusable as a bare query.
- **Query:** `"Island" AND ("enterprise browser" OR "Island Technology" OR cybersecurity)`
- **Negatives:** `tourism, resort, "island nation", weather`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 55. Kini
- **Risk:** Four letters, matches fragments and unrelated brands worldwide.
- **Query:** `"Kini" AND (startup OR funding OR Israeli OR technology)`
- **Negatives:** `bikini, Hawaii, "Kini Hawaii"`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 16. Lambda (lambda.ai)
- **Risk:** Collides with AWS Lambda, lambda calculus, Lambda Legal, particle physics.
- **Query:** `"Lambda Labs" OR ("Lambda" AND ("GPU cloud" OR "AI cloud" OR lambda.ai))`
- **Negatives:** `"AWS Lambda", "lambda calculus", "Lambda Legal", serverless`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 101. Launchpad
- **Risk:** Rocket launch pads, Salesforce Launchpad, accelerator programmes.
- **Query:** `"Launchpad" AND (startup OR funding OR platform)`
- **Negatives:** `rocket, "launch pad", NASA, SpaceX, accelerator program`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 241. Lemonade
- **Risk:** The beverage dominates; the insurer is also high-volume news.
- **Query:** `"Lemonade Insurance" OR ("Lemonade" AND (insurtech OR insurance OR NYSE))`
- **Negatives:** `recipe, drink, "lemonade stand", pink lemonade`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 173. MST
- **Risk:** Three-letter acronym: Mountain Standard Time, Military Sexual Trauma, many others.
- **Query:** `"MST" AND (startup OR Israeli OR technology OR funding)`
- **Negatives:** `"Mountain Standard Time", "MST3K", military`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 130. Near
- **Risk:** Preposition, plus NEAR Protocol (crypto) which generates heavy news volume.
- **Query:** `"Near Intelligence" OR ("Near" AND ("location data" OR "data intelligence"))`
- **Negatives:** `"NEAR Protocol", crypto, blockchain, "near future", "near miss"`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 83. Orchard
- **Risk:** Farming orchards plus a US proptech firm of the same name.
- **Query:** `"Orchard" AND (startup OR funding OR technology OR software)`
- **Negatives:** `apple orchard, farming, harvest, "Orchard Road"`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 117. Overtime
- **Risk:** Sports overtime, overtime pay, labour law.
- **Query:** `"Overtime" AND ("Overtime Elite" OR "sports media" OR "Overtime league")`
- **Negatives:** `"overtime pay", "overtime hours", "went to overtime", labor`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 77. Peak
- **Risk:** Peak season, peak oil, peak performance, mountain peaks.
- **Query:** `"Peak" AND ("Peak AI" OR "decision intelligence" OR "Peak.ai")`
- **Negatives:** `"peak season", "peak oil", mountain, hiking, "peak demand"`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 126. Ro
- **Risk:** Two characters. Matches inside countless words and abbreviations.
- **Query:** `"Ro Health" OR ("Ro" AND ("telehealth" OR "Roman health" OR "Ro.co"))`
- **Negatives:** `reverse osmosis, "RO water", Romania, ROI`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 17. SSI (Safe Superintelligence)
- **Risk:** Bare 'SSI' means Supplemental Security Income, server-side includes, solid-state and more.
- **Query:** `"Safe Superintelligence" OR "Safe Superintelligence Inc"`
- **Negatives:** `"Supplemental Security Income", "server side includes"`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 106. Shield
- **Risk:** Shield laws, S.H.I.E.L.D., Iron Dome shields, hundreds of products.
- **Query:** `"Shield" AND ("communications compliance" OR "Shield FC" OR regtech OR fintech)`
- **Negatives:** `Marvel, "shield law", missile, "human shield", windshield`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 256. Silo
- **Risk:** Data silos, farm silos, and the Apple TV+ series 'Silo'.
- **Query:** `"Silo" AND (startup OR funding OR "food supply" OR technology)`
- **Negatives:** `"data silos", "Apple TV", series, grain, missile silo`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 70. The EVERY Company
- **Risk:** 'Every' is the single hardest token in the list.
- **Query:** `"The EVERY Company" OR "EVERY Company" AND ("egg protein" OR "precision fermentation")`
- **Negatives:** `generic`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 10. Together AI
- **Risk:** 'Together' plus 'AI' is one of the most common phrase pairs in tech news.
- **Query:** `"Together AI" OR "Together Computer" OR together.ai`
- **Negatives:** `"work together", "come together", "together with"`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 147. Wave
- **Risk:** Waves of every kind, plus Wave accounting and Wave Mobile Money.
- **Query:** `"Wave" AND (startup OR funding OR Israeli OR technology)`
- **Negatives:** `ocean, heatwave, "wave of", radio waves, surfing`
- **Approve:** ☐ approved as-is   ☐ EDITED

---

## HIGH (32)

_Substantial false positives, or a large well-known entity shares the name._


### 64. AEYE Health
- **Risk:** Near-identical to AEye Inc., a publicly traded lidar company.
- **Query:** `"AEYE Health" AND (retinal OR diabetic OR screening OR FDA)`
- **Negatives:** `"AEye lidar", LIDAR, autonomous vehicle`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 32. Anthropic
- **Risk:** Very high news volume; 'anthropic principle' appears in cosmology coverage.
- **Query:** `"Anthropic" AND (Claude OR "Anthropic PBC" OR AI)`
- **Negatives:** `"anthropic principle", cosmology, anthropogenic`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 46. Arrow Global
- **Risk:** Arrow Global Group (UK debt purchaser) is a large, actively covered company.
- **Query:** `"Arrow Global" AND (Israeli OR startup OR funding OR technology)`
- **Negatives:** `"Arrow Global Group", debt purchaser, "LSE:ARW"`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 229. Beyond Meat
- **Risk:** Low ambiguity but high volume as a public company.
- **Query:** `"Beyond Meat"`
- **Negatives:** `—`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 129. BlueCircle (formerly Trellis)
- **Risk:** Blue Circle is a major cement brand; 'Trellis' is also generic.
- **Query:** `"BlueCircle" OR "Blue Circle" AND (startup OR funding OR technology)`
- **Negatives:** `cement, concrete, "Blue Circle Cement", garden trellis`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 9. Cerebras
- **Risk:** Low ambiguity but high volume (IPO coverage).
- **Query:** `"Cerebras"`
- **Negatives:** `—`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 113. Clinch
- **Risk:** 'Clinch a deal', boxing clinch, 'clinched the title' — very high noise.
- **Query:** `"Clinch" AND ("personalized advertising" OR "Clinch.co" OR martech)`
- **Negatives:** `"clinch a deal", "clinched", boxing, playoff`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 58. Connected Energy
- **Risk:** Generic industry phrase used in most energy-sector writing.
- **Query:** `"Connected Energy" AND ("battery storage" OR "second life" OR company)`
- **Negatives:** `"connected energy systems", "connected energy grid"`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 21. Databricks
- **Risk:** Low ambiguity but high volume.
- **Query:** `"Databricks"`
- **Negatives:** `—`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 163. Fireblade
- **Risk:** Honda CBR Fireblade is a well-known motorcycle.
- **Query:** `"Fireblade" AND (cybersecurity OR DDoS OR hosting OR startup)`
- **Negatives:** `Honda, motorcycle, CBR, superbike`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 110. Future Family
- **Risk:** Generic phrase in demographic and lifestyle writing.
- **Query:** `"Future Family" AND (fertility OR IVF OR financing OR fintech)`
- **Negatives:** `"future family planning", "the future family"`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 13. Glean
- **Risk:** 'Glean' is a common verb: 'we can glean from this'.
- **Query:** `"Glean" AND ("enterprise search" OR "Glean AI" OR workplace search)`
- **Negatives:** `"glean insights", "can glean", "gleaned from"`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 31. Groq
- **Risk:** One character from 'Grok' (xAI's model) — constant cross-contamination.
- **Query:** `"Groq" AND (LPU OR "inference chip" OR "Groq Inc")`
- **Negatives:** `Grok, "Grok AI", xAI chatbot`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 194. Hub Security
- **Risk:** Reads as a generic security-category phrase.
- **Query:** `"Hub Security" AND (HSM OR confidential OR Nasdaq OR Israeli)`
- **Negatives:** `"hub security model", "security hub", "AWS Security Hub"`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 54. IQM
- **Risk:** Three-letter token colliding with several acronyms.
- **Query:** `"IQM" AND (quantum OR "IQM Quantum Computers" OR Finland)`
- **Negatives:** `IQM index, medical acronym`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 122. MasterClass
- **Risk:** 'Masterclass' is now a common noun for any expert session.
- **Query:** `"MasterClass" AND ("MasterClass.com" OR subscription OR "online learning platform")`
- **Negatives:** `"a masterclass in", "masterclass performance", tutorial`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 45. Neolithics
- **Risk:** Near-collision with 'Neolithic' archaeology coverage.
- **Query:** `"Neolithics" AND (produce OR agritech OR "food quality" OR startup)`
- **Negatives:** `archaeology, "Neolithic period", excavation, ancient`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 37. OneAI
- **Risk:** 'One AI' is a generic phrase.
- **Query:** `"One AI" AND ("oneai.com" OR "language AI" OR "AI API")`
- **Negatives:** `"one AI model", "no one AI"`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 60. Oshi (formerly Plantish)
- **Risk:** 'Oshi' is heavily used in anime fandom (Oshi no Ko) and by an online casino.
- **Query:** `"Oshi" AND ("plant-based" OR seafood OR "Plantish") OR "Plantish"`
- **Negatives:** `"Oshi no Ko", anime, casino, manga`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 182. Powwow
- **Risk:** Cultural gatherings and the informal sense of 'a quick powwow'.
- **Query:** `"Powwow" AND (startup OR software OR enterprise OR funding)`
- **Negatives:** `tribal, "Native American", gathering, "quick powwow"`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 91. Privateer
- **Risk:** Historical naval term, plus Privateer Rum and Privateer Space.
- **Query:** `"Privateer" AND (startup OR funding OR "space debris" OR technology)`
- **Negatives:** `pirate, rum, historical, "privateer ship"`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 86. Quantum Machines
- **Risk:** 'Quantum machines' is standard phrasing across all quantum computing coverage.
- **Query:** `"Quantum Machines" AND (OPX OR "quantum control" OR Israeli OR funding)`
- **Negatives:** `"quantum machine learning", "quantum machines are"`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 247. Rewire
- **Risk:** 'Rewire' is a common verb in tech and neuroscience writing.
- **Query:** `"Rewire" AND (remittance OR "migrant banking" OR fintech OR Israeli)`
- **Negatives:** `"rewire the brain", "rewiring", electrical`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 27. Scale AI
- **Risk:** 'Scale AI' is also a generic phrase: 'enterprises scale AI initiatives'.
- **Query:** `"Scale AI" AND (Wang OR "data labeling" OR funding OR valuation)`
- **Negatives:** `"scale AI adoption", "scale AI initiatives", "to scale AI"`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 209. Signals Analytics
- **Risk:** Reads as a generic description of an analytics category.
- **Query:** `"Signals Analytics" AND (company OR acquired OR platform OR Israeli)`
- **Negatives:** `"signals analytics capability", "signal analytics"`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 14. SpaceX
- **Risk:** Low ambiguity but extreme volume — will dominate the run without a cap.
- **Query:** `"SpaceX"`
- **Negatives:** `—`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 28. Spot AI
- **Risk:** Generic phrase, plus Boston Dynamics' Spot robot.
- **Query:** `"Spot AI" AND ("video intelligence" OR camera OR surveillance)`
- **Negatives:** `"Boston Dynamics", "spot AI trends", parking spot`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 8. Stripe
- **Risk:** Very high news volume; 'stripe' also appears in fashion and design coverage.
- **Query:** `"Stripe" AND (payments OR fintech OR "Stripe Inc" OR Collison)`
- **Negatives:** `pinstripe, striped, "racing stripe", zebra`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 208. Tala
- **Risk:** Common given name; also places in the Philippines and Jordan.
- **Query:** `"Tala" AND (fintech OR "mobile lending" OR "emerging markets" OR funding)`
- **Negatives:** `"Tala Philippines" city, name, Talaat`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 48. Ursa Major
- **Risk:** The constellation appears constantly in science and astrology coverage.
- **Query:** `"Ursa Major" AND ("rocket engine" OR propulsion OR aerospace OR defense)`
- **Negatives:** `constellation, astronomy, "Big Dipper", horoscope`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 152. Verse.ai
- **Risk:** 'Verse' is common; several unrelated companies share it.
- **Query:** `"Verse.ai" OR ("Verse" AND ("conversational marketing" OR "SMS marketing"))`
- **Negatives:** `poetry, bible verse, "verse of", metaverse`
- **Approve:** ☐ approved as-is   ☐ EDITED

### 18. xAI
- **Risk:** Collides with XAI = explainable AI, a widely used technical term.
- **Query:** `"xAI" AND (Musk OR Grok OR "xAI Corp")`
- **Negatives:** `"explainable AI", "XAI methods", interpretability`
- **Approve:** ☐ approved as-is   ☐ EDITED

---

## Separate axis — high news volume (19)

_Not ambiguous. These simply generate enough coverage to consume the inference budget._
_Handled by `MAX_ITEMS_PER_COMPANY` (assumption A4), not query rewriting._

| # | Company | Also ambiguity-flagged? |
|---|---|---|
| 6 | Harvey | CRITICAL |
| 8 | Stripe | HIGH |
| 9 | Cerebras | HIGH |
| 10 | Together AI | CRITICAL |
| 14 | SpaceX | HIGH |
| 17 | SSI (Safe Superintelligence) | CRITICAL |
| 18 | xAI | HIGH |
| 21 | Databricks | HIGH |
| 27 | Scale AI | HIGH |
| 31 | Groq | HIGH |
| 32 | Anthropic | HIGH |
| 117 | Overtime | CRITICAL |
| 122 | MasterClass | HIGH |
| 126 | Ro | CRITICAL |
| 147 | Wave | CRITICAL |
| 191 | Astra | CRITICAL |
| 222 | Casper | CRITICAL |
| 229 | Beyond Meat | HIGH |
| 241 | Lemonade | CRITICAL |

---

_Generated during planning. Source: `ourcrowd_companies.txt` (258 names, no domains/sectors supplied — assumption A2)._