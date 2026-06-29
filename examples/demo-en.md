## Welcome to Achmage Slides Ultra

This document is a living manual that shows, page by page, how an ordinary Markdown note turns into presentation-grade slides. From this very page to the last one, every slide is built from **pure Markdown** alone, with no special slide syntax.

You write on the left, and the layout is decided automatically on the right. Type a heading, lay down a few list items, emphasize something with a callout now and then. That is all. The engine groups things into cards, aligns them, and carries the overflow to the next page for you.

As you flip through the pages that follow, watch how the same ingredients — heading, body, callout, list — unfold into strikingly different shapes depending on how you combine them.

## How to Read This Guide

This document flows in four parts. First body text and inline formatting, then callouts, then the real heart of this guide — **list card combinations** — and finally images and practical tips.

Each slide's title tells you exactly what that page demonstrates. So read the title first, then check with your own eyes whether the content below really renders that way. That is the fastest way to learn.

> [!tip] The single most important thing
> Card layouts only fire automatically on a slide that has **one heading and one list**. If you add body text or a callout, it renders as a normal flow instead of cards — so when you want cards, keep that page clean with nothing but the list.

## How Body Text Flows

Write a plain paragraph under a heading and it renders as body text. One paragraph stays as one block, and a blank line starts the next paragraph. When there is too much to fit on a page, the engine continues it onto the next page automatically.

On a roomy, text-only page the type is set slightly larger and centered to a comfortable reading width. That makes it perfect for floating a short declaration or an opening paragraph across a single slide.

When you want to explain at length, just keep writing paragraphs like this. Put your core claim in the first paragraph and unpack the evidence in the next, and your audience will follow along with ease.

## Inline Formatting at a Glance

Emphasis inside a sentence uses the Markdown you already know. **Bold** takes two asterisks, *italic* takes one, and `inline code` is wrapped in backticks. Highlight ==like this== with two equals signs, and a [link](https://obsidian.md) uses brackets and parentheses.

Identifiers like a `file path`, a `command`, or `manifest.json` stand out clearly from the surrounding text when wrapped in inline code. That is especially handy when your deck deals with technical terms.

> [!note] One-line summary
> Use **bold** for the core point, `code` for identifiers, and ==highlight== to catch the eye. Mixing just those three well already lifts a slide's readability.

## Callout Basics

A callout is made by writing its type in brackets after the quote mark `>`. You can add a title after the type, and the body starts on the next line.

> [!note] Note
> The most basic callout. Use it for supplementary explanation or things worth noting.

> [!tip] Tip
> Holds a piece of advice you want to offer the reader. Great for sharing a quick practical tip.

> [!warning] Warning
> Warns ahead of time about an easy mistake or a hard-to-undo action.

## Callouts That Inform

Even the same "notice" can be tuned by nuance. Below is the information and summary family.

> [!info] Info
> General information that adds context.

> [!important] Important
> Use it to nail down a key point you must not miss.

> [!abstract] Abstract
> Useful for showing the big picture of a section up front.

> [!summary] Summary
> Compresses a long passage into one block to wrap things up.

## Callouts for Success

The family you reach for when things went well, or when you want to point to a recommended direction.

> [!success] Success
> Clearly shows that a goal was achieved.

> [!example] Example
> Good for placing a concrete example next to an abstract explanation.

> [!done] Done
> Fits an item that is finished on a checklist.

> [!hint] Hint
> Use it to nudge toward the path without giving away the answer.

## Callouts That Warn

The higher the stakes, the stronger the color you use to grab attention.

> [!attention] Attention
> Points to the spot the audience should focus on right now.

> [!danger] Danger
> Use it for actions that could cause something fatal, like data loss.

> [!bug] Bug
> Honestly shares a known issue or limitation.

> [!fail] Failure
> Good for showing what not to do, or a common failure case.

## Questions, Quotes, and To-Dos

The family for asking as if in conversation, borrowing someone's words, or noting what needs doing.

> [!question] Question
> Use it to throw the audience something to think about.

> [!quote] Quote
> Carries an striking sentence or a sourced remark verbatim.

> [!cite] Citation
> Names the material you relied on to add trust.

> [!todo] To-Do
> You can leave the tasks to handle next, like a list.

## Mixing Body Text and Callouts

When you mix body text and a callout on one slide, you create a natural flow that explains and then immediately emphasizes. Pages like this are not turned into cards; they render as a normal top-to-bottom flow.

For instance, unpack a concept in a paragraph, then nail its core down with a single callout. When prose and emphasis take turns, the audience's rhythm comes alive.

> [!important] The rule when you mix
> When body text, callout, and list share one page, automatic card placement turns off. Instead, the list is refined into a small cluster of cards right where it sits.

## Two Side by Side: The Basic 2-Up Card

- **One heading, one list**: Put just a `##` heading and two items that begin with a bold label on a slide, and with no setup at all you get two cards split left and right.
- **The bold label is the key**: Start each item in bold and add a colon, and that part becomes the card title while the rest becomes the body. Remember this one rule and you are set.

## 2-Up: One Short, One Long Goes Asymmetric

- **The short one**: A single line stays narrow.
- **The long one**: This item runs much longer, so the width its card takes up naturally grows. The engine actually measures the amount of text in each card and grants more room to the card that carries more. So even when the two cards differ greatly in volume, neither looks empty nor cramped; the engine sets the left-right ratio differently to strike a pleasing balance. Just remember: the longer you write, the wider it gets.

## 2-Up: When Both Run Long

- **The first view**: When both cards carry long bodies, the engine takes two equally wide columns to balance the center of gravity. It suits explaining two contrasting positions at length in similar volume, and it secures enough margin and line spacing so each card reads like an independent little essay.
- **The second view**: Likewise, write this side long and you get a card of equal weight. But if both grow so long they cannot possibly fit one screen, a safety net kicks in that abandons the card placement and unspools them into a plain list onto the next page. So push the long-versus-long contrast only to a reasonable point.

## 2-Up: Nested List with Short Chips

- **Research**: We pursue academic depth.
    - Papers
    - Patents
    - Conferences
- **Teaching**: We help students grow.
    - Lectures
    - Mentoring
    - Advising

## 2-Up: Nested List with Long Definitions

- **Data infrastructure**: It means a findable, accessible data foundation.
    - Data organized in a standardized format can go straight into analysis without anyone touching it by hand, greatly cutting the cleanup cost in a project's early days.
    - Even material on the same topic costs enormous effort to integrate when every file has a different format, so fixing a consistent schema from the start pays off far more in the long run.
- **Governance**: It means a consistent and transparent decision system.
    - Who handles the data and by what standard must remain clearly written in documents, so that quality and trust never waver even when the person in charge changes.

## Three Pillars: An Even 3-Up Card

- **Research**: We pursue academic depth and create new knowledge.
- **Teaching**: We carefully help every single student grow.
- **Service**: We raise talent that contributes to the community.

## 3-Up: When Lengths Vary

- **Briefly**: One line.
- **Moderately**: A medium-length card holding a couple of lines of reasonable explanation.
- **At length**: This card is the longest of the three, so it is granted more room according to its measured volume of text. Even when the three cards differ in how much they carry, the engine weighs each one and sizes the cells differently, so the card with the most to say sits widest and the short card sits tidily, making the whole screen feel rhythmic.

## 3-Up: Nested with Short Chips

- **Input**: Write in plain Markdown.
    - Headings
    - Lists
    - Callouts
- **Process**: Read the structure and place it.
    - Measure
    - Route
    - Compose
- **Output**: It becomes a 1920×1080 slide.
    - Preview
    - Export
    - Share

## 3-Up: Nested with Long Definitions

- **The reality of public data**: Much of it is still hard for computers to read.
    - Many are scanned image-type PDFs, and item systems differ per file, making them hard to use as-is.
- **Change led by practitioners**: People on the front line drive the innovation themselves.
    - Not outside contractors but the practitioners who handle the data daily are changing it from the ground up.
- **Signs of change**: Administrative document formats are slowly opening up.
    - Attempts to move from proprietary formats to open ones, and further to Markdown, are on the rise.

## Four Beats: An Even 4-Up Card

- **Vision**: See far and draw big.
- **Mission**: Carry it out in daily execution.
- **Value**: Hold to an unshakable standard.
- **People**: In the end, people are everything.

## 4-Up: Mixing Lengths for Asymmetry

- **Short 1**: One line.
- **Long**: This item has a long enough body to take a wide column, granted the largest area among the four cards and pulling the eye first. The rule that more volume means more width applies just the same in a four-item layout.
- **Short 2**: One line.
- **Long again**: Likewise, write it long and it becomes a wide cell. When long and short cards alternate, a natural asymmetric grid forms instead of a monotonous four-way split, bringing the screen to life.

## 4-Up: Nested with Short Chips

- **Plan**: Decide what to build.
    - Goals
    - Scope
- **Design**: Decide how to build.
    - Structure
    - Flow
- **Build**: Actually make it.
    - Write
    - Verify
- **Ship**: Deliver the result.
    - Present
    - Deploy

## Five Key Drivers on One Screen

- **Data infrastructure**: A findable, reusable data foundation.
- **Talent**: Securing and retaining core people.
- **Policy**: Proactive strategy and institutional reform.
- **Infrastructure investment**: Steady expansion of compute and funding.
- **Governance**: Consistent and transparent decisions.

## A Single Card: One Flat Item

- **One principle**: Well-refined Markdown data is both the start and the end of a good slide. When there is only a single item, the engine makes it one large card spread across the screen, branding the single most important message strongly.

## A Single Card: One Item with a Definition

- **What data infrastructure is**: It refers to a data foundation that follows the FAIR principles.
    - It means a state that satisfies all four conditions — being Findable, Accessible, Interoperable, and Reusable — which becomes the precondition for all proper use of data. Even with a single item, attach an explanation beneath it and you get an annotated card that places the label large up top and spreads the gloss wide below.

## Plain Bullets Stay as a List

- A bullet that simply lists a sentence with no bold label is not forced into a card.
- Instead it is tidied into a calm, label-free list that reads from top to bottom.
- So a plain enumeration that does not suit cards looks like a plain enumeration, and you add a bold label only when you want to emphasize.

## Many Words, One Label

- **National AI strategy planning**: When several bold words run before the colon, the whole stretch merges into one label.
    - It naturally reads spaced-out bold phrases as a single chunk of a title, so even a long, formal name becomes a card title smoothly.
- **Non-oil sector GDP share**: Likewise, a multi-word label goes in as a single-line title as-is.
    - Even a long label stays clearly distinct from the body, which is handy when dealing with long names like a policy or an index.

## Forcing with a Marker: Spread as Bento

<!-- bento -->

- **Item one**: This explanation is a long sentence that easily runs past one line, so automatic judgment would have sent it to the definition grid, but the marker written above forces the placement into bento.
    - The sub-line is also written long, deliberately showing it is the volume that would have gone elsewhere without the marker.
- **Item two**: Another long explanatory sentence fills two lines or more.
    - Writing just one marker line at the top of the slide like this overrides the engine's automatic judgment and locks in the placement you want.

## Forcing with a Marker: Definition Grid (rows)

<!-- rows -->

- **Left is the label, right is the gloss**: The definition grid is a placement that pairs a term and its explanation side by side.
    - It fits content where short names and long explanations repeat, like a glossary or a set of concept notes.
- **Locking it with a marker**: Write the marker above and it locks into this definition layout regardless of content length.
    - Useful when you want to show the same list as a definition grid rather than cards, depending on the presentation context.

## Forcing with a Marker: Six Items in Four Columns

<!-- cards: 4 -->

- **One**: A short note.
- **Two**: A short note.
- **Three**: A short note.
- **Four**: A short note.
- **Five**: A short note.
- **Six**: A short note.

## When There's a Lot, It Splits Across Pages

- **Never truncated, automatically**: When there are too many cards to place on one slide, or the body is so long it spills past one page, the engine divides the items appropriately and spreads them across several card pages instead of shrinking or cutting the content. So the presenter need not calculate in advance how much fits on a page; just write everything you want to say. Managing the volume is the engine's job, and we focus only on the content.
- **Continued pages get a marker**: From the second page that is split automatically like this, a marker is appended after the title to signal it is continued content, so the audience sees at a glance that the same topic carries on. It flows seamlessly onto the next page, which is especially handy when you want to explain one topic fully across several pages.
- **The card shape stays the same**: Even when split across pages, each page keeps the very same card-grid design. Because the first and second pages continue in the same shape, the flow is not broken, and it looks as if one page was naturally extended. So do not be afraid to write at length.

## When a Paragraph Shares the Slide with Cards

This page has a body paragraph first, then a bold-label list below it, then a closing paragraph again. When it mixes with other blocks like this, the whole is not turned into cards; only the list part is refined into a small cluster of cards.

- **The role of the front paragraph**: It lays the context before you enter the cards.
- **The role of the back paragraph**: It sums up the conclusion once more after the cards.

So when you want to bridge explanation and cards naturally, just slot a list between paragraphs like this.

## Images Fill the Screen

![Demo image](https://picsum.photos/seed/achmage/1600/900)

## How Slides Are Split

A new slide starts at a `##` heading. As you write, when you hit the next `##`, a new page begins from there. So just place one `##` heading wherever you want to break a page.

You need not worry even when the content overflows a page. The engine carries the overflow onto the next page on its own and refines it so that neither card nor body gets cut off.

> [!tip] You can use a divider too
> When you want to break a page without a heading, put a horizontal rule `---` on its own line, and the slide splits right there.

## The Three Heading Levels

This document uses only three heading levels. Here is what each is for.

### Big heading — the face of the slide

`##` is a page's representative title. A new slide starts here, and it sits largest at the very top of the screen.

### Middle heading — a group within the page

`###` is for dividing content into small groups within one slide, like the line just above this paragraph.

#### Small heading — a detail label

`####` is the smallest heading, for when you want to divide even more finely. It is well suited to naming detail items.

## Frequently Asked Questions

> [!question] Do I have to learn a separate slide syntax?
> No. The Markdown you usually write is enough. Headings, lists, callouts, and images are all you need.

> [!faq] My cards aren't forming
> Check whether body text or a callout is mixed into that slide. Cards fire only when there is exactly one heading and one list.

> [!question] What if the content gets cut off?
> It does not get cut. When it overflows, it either continues onto the next page or the cards unspool into a plain list so everything stays visible.

## The Golden Rules to Remember

> [!summary] Three-line summary
> First, a new page starts with `##`. Second, when you want cards, fill that page with nothing but a bold-label list. Third, leave emphasis to callouts and trust the engine for the rest.

You have seen across the previous pages that changing only length and nesting unfolds the same list into entirely different cards. Mix short and long, alternate chips and definitions, and find the placement that fits best.

## Now Make Your Own

That is everything. Create a new note, write one `##` heading, and start writing whatever you want to say in Markdown beneath it.

> [!success] Ready to go
> Your note is already a slide. Open the slide preview and watch your deck come together from the very moment you start writing.
