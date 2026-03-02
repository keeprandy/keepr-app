# Keepr – 14 Day MVP

Day 1
- [ ] Run baseline on phone/emulator
- [ ] Test boat photo add
- [ ] Test service event add
- [ ] Test one home / one vehicle / one boat
- [ ] Note which screen(s) feel broken/confusing

14 Day Plan _Starting December 4th - December 18th 
What you need right now (and what we’ll execute):
1. A focused MVP that delivers the promise of Keepr
This means one thing:
A working, stable experience that proves:
•	Assets can be added easily
•	Photos tell the story
•	Events maintain the value
•	The timeline makes the asset feel alive
•	Exporting “the story” is compelling
If someone downloads the app and says “oh, I get this — I want to put my stuff in here,” you’re in business.
That’s the MVP.
It’s not mAIntAIn v2.
It’s not integrations.
It’s not enterprise workflow.
 
2. Under the hood — not complicated, but not sloppy
This matters because you may get more traction than expected.
Your architect is right:
You need a clean backbone (Supabase schema + simple contexts + UPIP), so when you go from 10 users to 1,000, nothing implodes.
But for the MVP, the shape is simple:
Assets → Events → Photos → Pros
(Everything relates back to an asset.)
That’s enough to scale into the real future.
 
3. A 14-day plan that cannot stall
Yesterday stalled because the plan became too abstract.
Today we fix that.
Here’s a non-negotiable, executable 14-day plan that will ship the MVP.
 
🔥 14-DAY EXECUTION PLAN (REALISTIC, MVP-FOCUSED)
Day 1–2 (Today + Tomorrow): Re-solidify the baseline
•	Clean copy of the current ZIP is official baseline
•	No redesigns
•	Fix broken flows (photo injection, event display, hero updates)
•	Lock UPIP back in as system-wide photo intake
•	Restore consistency: Garage, Boats, Homes all use same event/timeline structure
Output: Stable, running app with no regressions.
 
Day 3–5: Build the unified Timeline
This is your signature feature.
Deliverables:
•	Single scrollable timeline
•	Filter by event type
•	Groups photos, notes, service events
•	Works across all asset types
•	Timeline is the default "story" view
•	Export panel: checkboxes for what to include
Output: The emotional, “wow I see my asset's life” feature.
 
Day 6–8: Solidify UPIP + Asset Add flow
This ensures you scale later without chaos.
•	UPIP intercepts all images
•	Runs analysis
•	Auto-tags and routes
•	Reduces manual entry
•	Normalized photo → event mapping
Output: A future-proof intake system that supports v1, v2, v3.
 
Day 9–11: Export Engine v1
This is key for buyer handoff and value story.
•	Select items
•	Export as PDF or bundle
•	Clean formatting
•	Ready for “Send to new owner”
Output: First monetizable feature.
 
Day 12–14: Polish, QA, and Packaging for release
•	Fix edges
•	Smoke test all screens
•	Compress images
•	Prepare build for App Store TestFlight
•	Create a small landing page + QR to TestFlight
•	Add analytics hooks
Output: You have a real, demoable, testable public MVP.

If Time Permits... 
Add KALM - Keepr Asset Lifecycle Management
f you want, I can now generate:

✔️ The formal KALM spec document
✔️ The Supabase schema migration for identifiers
✔️ The roadmap showing where KALM threads through your app
✔️ The updated deployment checklist for MVP


 
Why this works
Because it’s:
1.	Focused — no distractions
2.	Foundational — uses scalable patterns
3.	Market-ready — enough for people to understand the value
4.	Brand coherent — the “story” is the heart of Keepr
5.	Technically safe — you won’t have to rebuild from scratch in 90 days
This is exactly how companies like Notion, Calm, and Carfax-like platforms launched their first usable version.

