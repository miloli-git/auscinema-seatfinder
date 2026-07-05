## **BLUF**

- Use the **Double Diamond** as your spine: understand the real problem, define it sharply, explore multiple solutions, then ship the best-tested one. The Design Council frames this as **Discover, Define, Develop, Deliver**. ([designcouncil.org.uk](https://www.designcouncil.org.uk/resources/the-double-diamond/))
- Do **lo-fi before hi-fi**. A polished mock too early hides weak product thinking. First validate the user job, flow, labels, and decision model.
- For a solo builder, the process is: **research → synthesize → frame → flows → wireframes → prototype → usability test → visual system → build → measure**.
- The biggest mistake to avoid: designing a ranked-list interface before proving that a ranked list matches how people actually choose a movie session and seat.
- For AusCinema Seat Finder, the next phase should start from: **“I want to see this film well”**, not “show me cinemas/times/seats.”

## **The Frameworks**

| Framework | Core Idea | Best Use | Solo-Builder Adaptation |
|---|---|---|---|
| IDEO / Human-Centered Design | Balance what is desirable for people, feasible with technology, and viable as a product. ([designthinking.ideo.com](https://designthinking.ideo.com/)) | Keeping user need ahead of feature enthusiasm | Use it as a weekly check: user value, technical reality, public-side-project scope |
| Design Thinking | Empathize, define, ideate, prototype, test. IxDF attributes this common 5-stage model to Stanford d.school. ([ixdf.org](https://ixdf.org/literature/article/5-stages-in-the-design-thinking-process)) | Learning the discipline | Treat stages as repeatable loops, not a waterfall |
| NN/g Design Thinking | Understand, explore, materialize, with 6 phases: empathize, define, ideate, prototype, test, implement. ([nngroup.com](https://www.nngroup.com/articles/design-thinking/)) | Practical UX sequencing | Add “implement” explicitly so design ends in shipped product |
| Double Diamond | First diamond explores and defines the problem; second explores and delivers the solution. ([designcouncil.org.uk](https://www.designcouncil.org.uk/resources/the-double-diamond/)) | Avoiding solution-first thinking | Use this as the main operating model |
| Lean Startup / Lean UX | Build, measure, learn, but first identify the problem and MVP needed to learn quickly. ([theleanstartup.com](https://theleanstartup.com/principles)) | Shipping without over-designing | Every release should test one explicit assumption |
| GV Design Sprint | 5-day shortcut to answer critical questions through design, prototype, and customer testing. ([gv.com](https://www.gv.com/sprint/)) | Getting unstuck quickly | Run a solo 2 to 3 day mini-sprint when direction is unclear |

**Use this hybrid:** Double Diamond for structure, Design Thinking for mindset, Lean UX for shipping discipline, GV sprint when you need a compressed decision.

## **Solo-Builder Workflow**

| Stage | Goal | Activities | Artifacts | Minimum Viable Version |
|---|---|---|---|---|
| 1. Frame the design challenge | Stop designing the wrong thing | Write target user, situation, current workaround, pain, desired outcome | Problem statement, assumptions list | 1-page brief |
| 2. Lightweight research | Learn how people really decide | Interview 5 to 8 moviegoers, observe how they choose film/session/seat, inspect competing flows | Interview notes, patterns, quotes | 5 conversations plus 3 competitor walkthroughs |
| 3. JTBD synthesis | Define the real job | Convert findings into functional, emotional, social jobs. JTBD focuses on circumstances and forces behind decisions, not demographics. ([christenseninstitute.org](https://www.christenseninstitute.org/theory/jobs-to-be-done/)) | JTBD statement, decision criteria | “When I want to see X, help me Y, so I can Z” |
| 4. Journey map | See the whole experience | Map from “I want to see this movie” to official booking handoff | Journey map with actions, thoughts, pain points. NN/g describes journey mapping as goals/actions over time plus thoughts/emotions. ([nngroup.com](https://www.nngroup.com/articles/customer-journey-mapping/)) | 6-step text journey |
| 5. Information architecture | Decide what users need first | Group content: film, nearby sessions, seat quality, cinema constraints, handoff | IA outline, screen inventory | One sitemap or screen list |
| 6. User flows | Make the product path explicit | Draw happy path, comparison path, unavailable-seat path, handoff path | Flow diagram | Boxes and arrows in FigJam or paper |
| 7. Divergent concepts | Avoid first-idea lock-in | Sketch 3 to 5 different approaches: film-first wizard, best-session card, map/table hybrid, conversational filter | Concept sketches | 3 messy sketches |
| 8. Wireframes | Solve structure before styling | Layout screens in grayscale. Figma defines wireframes as blueprints for layout, nav, components, and interactions. ([figma.com](https://www.figma.com/resource-library/what-is-wireframing/)) | Lo-fi wireframes | Mobile-first key path only |
| 9. Prototype | Make it testable | Link the critical path: choose film, compare sessions, understand seat recommendation, handoff | Clickable prototype | 5 to 7 linked screens |
| 10. Usability test | Find where thinking breaks | Give users tasks, watch silently, ask why after | Findings, severity list | 5 users, 30 minutes each |
| 11. Visual/UI design | Add hierarchy, trust, polish | Define type, spacing, color, icons, card patterns, states | Small design system | Tokens plus 6 reusable components |
| 12. Build MVP | Ship the tested path | Implement only what supports the validated flow | Working product | One city, one cinema chain or data slice if needed |
| 13. Measure and learn | Keep improving after launch | Track search start, recommendation viewed, handoff click, abandonment | Analytics dashboard, issue log | 5 events and weekly review |

## **How To Iterate**

Use this loop:

1. **Question:** What assumption are we testing?
2. **Diverge:** Generate multiple answers.
3. **Converge:** Pick one using user fit, feasibility, and clarity.
4. **Prototype:** Make the cheapest artifact that can test it.
5. **Test:** Watch real users attempt realistic tasks.
6. **Decide:** keep, revise, or kill.

Practical rules:

- Test **problem framing** before UI: “Tell me about the last time you chose a movie session.”
- Test **concepts** before wireframes: “Which of these ways of choosing feels closest to how you think?”
- Test **wireframes** before visual design: “Find the best way to see this movie tonight.”
- Test **hi-fi** only after structure works.
- NN/g’s 5-user rule is useful for qualitative formative testing: small rounds with about 5 users beat one big late test. ([nngroup.com](https://www.nngroup.com/articles/why-you-only-need-to-test-with-5-users/))
- Do 2 to 4 loops before build. Stop when the same major failure stops appearing and users can complete the core task without your explanation.
- Do not ask users “would you use this?” Watch whether they understand it, trust it, and can act on it.

## **Applied To Seat Finder**

**Reframed product promise**

“Pick the best real-world way to see this film, including session, cinema, and seat tradeoffs, then hand me off to official booking.”

**Discovery questions**

- Last time you saw a movie in cinema, how did you choose the session?
- What made a seat good or bad?
- What tradeoffs matter: screen size, recliner, crowding, price, travel, time, companions, accessibility?
- When do you abandon a session?
- What information do booking sites fail to show clearly?

**Likely JTBD**

“When I already want to see a specific film, help me find the session and seat that will make it feel worth going out for, so I can book confidently without comparing every cinema manually.”

**Core flow**

1. User selects or searches film.
2. Product asks lightweight context: location, date flexibility, party size, seating preferences.
3. Product shows **best ways to see this film**, not a generic list.
4. Each recommendation explains the tradeoff: “best screen,” “best seat availability,” “quietest likely session,” “best time after work.”
5. User opens a recommendation, sees seat guidance and confidence level.
6. User clicks through to official booking.

**First concepts to sketch**

- **Best Option First:** one primary recommendation plus alternatives.
- **Tradeoff Chooser:** user picks “best screen,” “least crowded,” “best seats left,” “soonest.”
- **Film Night Planner:** “I want to see Dune tonight near me with two people.”
- **Seat Confidence View:** session card includes likely best zones, availability risk, and handoff.

**First usability test task**

“You want to see a specific film this Saturday night with one other person. Use this prototype to find the option you would actually book.”

Watch for:

- Do users understand why a recommendation is best?
- Do they trust the seat logic?
- Are they forced to do comparison work themselves?
- Does the handoff feel clear or like a dead end?

## **Tooling**

| Stage | Good Tools | AI Fit |
|---|---|---|
| Brief / assumptions | Markdown, Notion, Obsidian | Turn messy notes into assumptions and test questions |
| Research | Google Meet, phone, notes, Dovetail if needed | Summarize transcripts, but verify against notes |
| Synthesis | FigJam, Miro, paper | Cluster quotes, draft JTBD variants |
| IA / flows | FigJam, Whimsical, Excalidraw | Generate alternate flow diagrams |
| Wireframes | Figma, Balsamiq, paper | Produce layout options, not final truth |
| Prototype | Figma prototype tools | Help write microcopy and edge states |
| Testing | Maze, Useberry, Lookback, Zoom | Summarize findings only with citations back to sessions |
| IA testing | Optimal Workshop tree testing | Useful if navigation/labels become complex |
| Visual system | Figma variables/components | Generate token suggestions, compare component states |
| Build/measure | PostHog, Plausible, GA4, logs | Analyze funnels and propose hypotheses |

Important AI caution: NN/g found AI research tools can miss usability context, produce vague recommendations, and lack reliable citation. Use AI as an assistant, not as a replacement for watching users. ([nngroup.com](https://www.nngroup.com/articles/ai-powered-tools-limitations/))

## **Sources**

- IDEO, “Design Thinking by IDEO” ([designthinking.ideo.com](https://designthinking.ideo.com/))
- IDEO.org Design Kit methods ([designkit.org](https://www.designkit.org/methods.html))
- Design Council, “The Double Diamond” ([designcouncil.org.uk](https://www.designcouncil.org.uk/resources/the-double-diamond/))
- Nielsen Norman Group, “Design Thinking 101” ([nngroup.com](https://www.nngroup.com/articles/design-thinking/))
- Interaction Design Foundation, “The 5 Stages in the Design Thinking Process” ([ixdf.org](https://ixdf.org/literature/article/5-stages-in-the-design-thinking-process))
- GV, “The Design Sprint” ([gv.com](https://www.gv.com/sprint/))
- Lean Startup methodology ([theleanstartup.com](https://theleanstartup.com/principles))
- Christensen Institute, “Jobs to Be Done Theory” ([christenseninstitute.org](https://www.christenseninstitute.org/theory/jobs-to-be-done/))
- NN/g, “When to Use Which User-Experience Research Methods” ([nngroup.com](https://www.nngroup.com/articles/which-ux-research-methods/))
- NN/g, “Why You Only Need to Test with 5 Users” ([nngroup.com](https://www.nngroup.com/articles/why-you-only-need-to-test-with-5-users/))
- NN/g, “Customer Journey Maps” ([nngroup.com](https://www.nngroup.com/articles/customer-journey-mapping/))
- Figma, “What is Wireframing?” ([figma.com](https://www.figma.com/resource-library/what-is-wireframing/))
- Figma, prototyping and design systems docs ([figma.com](https://www.figma.com/prototyping/)) ([figma.com](https://www.figma.com/design-systems/))
- Figma/Maze prototype testing help ([help.figma.com](https://help.figma.com/hc/en-us/articles/360041246514-Test-your-Figma-prototypes-with-Maze))
- Optimal Workshop, tree testing overview ([optimalworkshop.com](https://www.optimalworkshop.com/101-guides/tree-testing-101/tree-testing-overview))
- NN/g, “AI-Powered Tools for UX Research: Issues and Limitations” ([nngroup.com](https://www.nngroup.com/articles/ai-powered-tools-limitations/))
