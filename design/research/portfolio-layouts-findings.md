## BLUF

- Replace the 2-column iframe grid with a **case-study showcase**: one strong hero, one chosen “recommended direction,” then the seven explorations as evidence of method.
- Lead with the differentiator: **“I used real cinema data and extracted design systems from live brands to explore interface directions.”** That is the story, not an apology.
- Do **not** make seven mocks compete equally. Curate them into a decision arc: baseline → design-system experiments → real-auditorium/data direction → final recommendation.
- Use one live interactive mock above the fold or early on, then lazy-load the rest behind tabs/cards. Seven always-on iframes will feel slow and visually noisy.
- Hiring reviewers want process, role, constraints, rationale, iteration, and impact, not just polished screens. NN/g’s hiring-manager research explicitly says portfolios should show process beyond final UI screenshots and stay scannable. ([nngroup.com](https://www.nngroup.com/articles/ux-design-portfolios/))

## Recommended Structure

### 1. Hero: “Designing a better cinema seat picker”

Above the fold:

- One large screenshot or live embed of the strongest direction.
- One-line thesis:  
  **“AusCinema Seat Finder scores real auditorium seats and hands users off to official booking. This page shows how I explored seven UI directions using real data and scraped design-system references.”**
- Three facts in a compact metadata row:
  - Role: solo builder, backend/AI orchestration, UI exploration
  - Inputs: real auditorium layout, seat-quality scoring, scraped design systems
  - Output: seven whole-page prototypes, one recommended direction
- CTAs: `Try live project`, `View GitHub`, `Jump to explorations`

Why: hiring managers scan quickly. UX Tools notes initial portfolio review can be around 90 seconds, so the lead must communicate the project format and why it matters immediately. ([uxtools.co](https://www.uxtools.co/blog/5-principles-of-exceptional-case-studies-in-ux-portfolios))

### 2. The Product Problem

Short, concrete:

- “Cinema booking maps show availability, not seat quality.”
- “Users need to know which available seat is actually worth sitting in.”
- “The app scores seats and routes to the official booking path instead of replacing the cinema checkout.”

Include one simple diagram: cinema data → scoring model → seat recommendation → official booking.

### 3. The Method: “Seven directions, three input types”

This is where the page becomes distinctive.

Use a horizontal process strip:

1. Baseline functional UI
2. Extracted Locomotive-inspired system
3. Extracted Glossier-inspired system
4. Extracted Sydney Opera House-inspired system
5. Other visual direction
6. Other visual direction
7. Real auditorium layout from real data

For each, show:

- Source/inspiration
- What system tokens were extracted or inferred
- What the direction tested
- What survived into the recommendation

This frames the seven screens as controlled exploration, not a dump.

### 4. Recommended Direction

Pick one direction and say why.

Structure:

- Big live preview or screenshot
- “Why this direction wins”
- Decision criteria table:
  - Seat legibility
  - Trust in score
  - Mobile viability
  - Booking handoff clarity
  - Visual distinctiveness
  - Implementation cost
- 3 to 5 annotated callouts on the mock

This is important because NN/g says hiring managers want to know what did not make it into a design and why, not just what did. ([nngroup.com](https://www.nngroup.com/articles/ux-design-portfolios/))

### 5. Exploration Gallery, But Curated

Replace the iframe grid with a **single active preview switcher**:

- Left: sticky list of seven directions with short labels.
- Right: one active iframe or screenshot preview.
- Below the active preview: “What this tested,” “What worked,” “What I would drop.”
- Add `Open full screen` for each direction.

Default to screenshots for all inactive directions. Load iframe only when selected.

### 6. Real Data Deep Dive

Give the real auditorium its own section.

Show:

- Raw-ish auditorium layout thumbnail
- Scored seat overlay
- Explanation of scoring factors
- Edge cases: aisles, screen distance, row geometry, unavailable seats
- Why this matters: it proves the design is grounded in system behavior, not decorative theming

This is the section that makes a backend/AI-agent builder credible in design: the UI is downstream of a real model.

### 7. What I Learned / What I’d Build Next

Keep it honest and specific:

- “Design-system extraction gives useful constraints, but brand borrowing cannot replace product fit.”
- “Seat-map legibility beats aesthetic novelty.”
- “The strongest direction is the one where scoring, trust, and handoff are clearest.”
- Next steps: mobile booking path, accessibility pass, compare scoring explanation variants, user test with real moviegoers.

IxDF recommends ending case studies with outcomes and lessons because reflection shows growth and judgment. ([ixdf.org](https://ixdf.org/literature/article/how-to-write-great-case-studies-for-your-ux-design-portfolio))

## Pattern Catalogue

### 1. Narrative Case-Study Scroll

Use when: the main strength is reasoning, systems thinking, and convergence.

Structure:

1. Hero result
2. Problem
3. Constraints
4. Exploration method
5. Key directions
6. Decision criteria
7. Recommended direction
8. Lessons

Best fit here: **Yes, primary structure.** It turns seven mocks into a story.

### 2. Annotated Hero + Supporting Gallery

Use when: one direction is clearly strongest but the others prove range.

Structure:

1. Full-width recommended design
2. Numbered annotations
3. “Why this won”
4. Smaller cards for alternate directions
5. Expandable detail per direction

Best fit here: **Strong.** It avoids equal-weight comparison and gives the reviewer a clear takeaway.

### 3. Live Direction Switcher

Use when: the prototypes are actually interactive and worth trying.

Structure:

1. Segmented control or vertical nav with seven directions
2. One live preview viewport
3. Notes panel changes with selected direction
4. Full-screen links
5. Lazy iframe loading

Best fit here: **Strong, but use after the narrative intro.** Do not make it the whole page.

### 4. Decision Log / Design Matrix

Use when: the differentiator is analytical choice-making.

Structure:

1. Criteria definition
2. Matrix comparing directions
3. Short rationale per score
4. “Decision made”
5. Evidence screenshots

Best fit here: **Excellent for the convergence section.** This plays directly to backend/system strengths.

### 5. Before / After / Beyond

Use when: there is a clear current-state product and a target-state UI.

Structure:

1. Existing booking-seat-map limitation
2. AusCinema scoring layer
3. UI directions as “beyond availability”
4. Final recommended experience

Best fit here: **Useful as a subsection**, especially if you can show a typical cinema seat picker beside your scored version.

## What To Steal

- **Simon Pan, Uber case study**: Steal the narrative arc: context, scale problem, research/data, reframed problem, concepts, tradeoffs, impact. His homepage also puts quantified outcomes directly on project cards. ([simonpan.com](https://simonpan.com/)) ([simonpan.com](https://simonpan.com/work/uber/))
- **Lawrence Zheng**: Steal the way technical/product outcomes are made visible with large metrics and concise project framing. Also relevant because he explicitly frames a programmer background as a design strength. ([lawrencezheng.com](https://www.lawrencezheng.com/))
- **Vera Chen**: Steal the compact project-card taxonomy. Her homepage labels work by platform/type such as desktop, framework, CRM, design system, internship, side project. ([verachen.me](https://www.verachen.me/))
- **Ed Chao**: Steal the restraint. His portfolio is basically a minimal work index with strong project titles, which is useful if the work itself is dense. ([thatedchao.com](https://www.thatedchao.com/))
- **NN/g portfolio guidance**: Steal the discipline: quality over quantity, scannable case studies, and focus on how you worked. ([nngroup.com](https://www.nngroup.com/articles/ux-design-portfolios/))

## Pitfalls

- **Do not present seven equal tiles as the main event.** Equal weight says “I made options.” A case study says “I made decisions.”
- **Do not overclaim as a visual designer.** Say “AI-native product builder exploring UI systems” or “full-stack builder using design-system extraction and real data to prototype product directions.”
- **Do not hide the real data angle.** The real auditorium layout should be a headline proof point.
- **Do not rely on iframes for first impression.** Web.dev notes iframes can consume bandwidth and CPU because each is a separate document with subresources. Use screenshots first, then lazy-load live previews. ([web.dev](https://web.dev/learn/performance/lazy-load-images-and-iframe-elements?utm_source=openai))
- **Do not make the scraped-design-system work look like copying.** Frame it as “reference-system extraction to understand layout, type, color, motion, and interaction constraints,” then explain where you diverged for product fit.
- **Do not bury the conclusion.** Show the recommended direction early. UX Tools and IxDF both recommend showing the result upfront, then deconstructing how you got there. ([uxtools.co](https://www.uxtools.co/blog/5-principles-of-exceptional-case-studies-in-ux-portfolios)) ([ixdf.org](https://ixdf.org/literature/article/how-to-write-great-case-studies-for-your-ux-design-portfolio))

## Sources

- NN/g: “5 Steps to Creating a UX-Design Portfolio”  
  https://www.nngroup.com/articles/ux-design-portfolios/
- Indeed Design: “UX Design Portfolio Advice from Hiring Managers”  
  https://indeed.design/article/ux-design-portfolio-advice-from-hiring-managers/
- UX Tools: “5 Principles of Exceptional Case Studies in UX Portfolios”  
  https://www.uxtools.co/blog/5-principles-of-exceptional-case-studies-in-ux-portfolios
- IxDF: “How to Write UX/UI Design Case Studies That Boost Your Portfolio”  
  https://ixdf.org/literature/article/how-to-write-great-case-studies-for-your-ux-design-portfolio
- Simon Pan portfolio and Uber case study  
  https://simonpan.com/  
  https://simonpan.com/work/uber/
- Lawrence Zheng portfolio  
  https://www.lawrencezheng.com/
- Vera Chen portfolio  
  https://www.verachen.me/
- Ed Chao portfolio  
  https://www.thatedchao.com/
- web.dev iframe lazy-loading/performance guidance  
  https://web.dev/learn/performance/lazy-load-images-and-iframe-elements
