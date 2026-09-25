# Design System Documentation

## Design Philosophy

Build applications that work beautifully on both mobile and desktop. Treat both as first-class experiences with interfaces that adapt intelligently to screen size, input method, and usage context.

Focus on:

- **Native-feeling experiences**: Touch-friendly on mobile, precise pointer interactions on desktop
- **Progressive disclosure**: Reveal complexity gradually, surface only what's needed
- **Responsive patterns**: Adapt layouts and navigation based on available space
- **Distinctive aesthetics**: Create interfaces that feel artisanally crafted and specific to their purpose, avoiding generic or predictable design patterns

## Design Thinking Process

Before implementing, understand the context and commit to a clear aesthetic direction:

**Purpose & Context**

- What problem does this interface solve? Who uses it and in what circumstances?
- Consider the emotional tone: professional, playful, meditative, energetic, luxurious, utilitarian?
- Identify technical constraints: performance needs, accessibility requirements, platform limitations

**Aesthetic Direction**
Choose a bold, intentional direction rather than playing it safe. Options include (but are not limited to):

- Brutally minimal with surgical precision
- Editorial/magazine layouts with dramatic typography
- Warm and organic with natural textures
- Futuristic with geometric precision
- Brutalist with raw, utilitarian elements
- Soft and playful with rounded forms
- Industrial with functional beauty
- Maximalist with controlled chaos

**Critical**: The goal is not to always be extreme, but to be _intentional_. Both refined minimalism and bold maximalism work when executed with conviction and consistency.

**Differentiation**

- What makes this interface memorable and distinctive?
- What's the one detail or quality someone will remember?
- How does this avoid looking like generic, cookie-cutter design?

Then implement production-grade code that is functional, visually striking, and cohesive from first pixel to last interaction.

## Responsive Design Principles

### Core Patterns

**Master-Detail Navigation**

- Mobile: Separate list and detail views, use bottom sheets/dialogs for actions
- Desktop: Side-by-side layouts, modals/side panels for focused tasks

**Progressive Disclosure**

- Show what users need now, hide complexity until needed
- Stack-based navigation on mobile, multi-column layouts on desktop

**Celebration Moments**

- After creative/magical actions, transition to immersive result pages
- Full-screen on mobile, spacious centered layouts on desktop

**Touch & Interaction**

- Mobile: 44×44px minimum touch targets, thumb-friendly bottom placement
- Desktop: Clear hover/focus states, keyboard navigation support

### State Management Best Practices

**Avoid Unnecessary Refetches**

- Only refetch data when it has actually changed
- Use background updates that don't disrupt the current view
- Show subtle indicators during refreshes, keep current content visible

**Preserve User Input**

- Never reset form fields or state as a side effect of data fetching
- Clean up state only in response to explicit user actions (save, cancel, reset)
- Use optimistic updates to keep the interface fast and responsive

**Prevent Flicker**

- Don't show loading states for data that's already present
- Use placeholderData: keepPreviousData in React Query to avoid flashes
- Prefer skeletons over blank content during initial loads

## Frontend Aesthetics Guidelines

Focus on these key areas to create distinctive, production-grade interfaces:

**Typography**

- Choose fonts that elevate the interface aesthetics
- Avoid overused defaults (Inter, Roboto, Arial, system fonts unless specifically appropriate)
- Pair distinctive display fonts with refined body fonts
- Use hierarchy, weight, and spacing deliberately
- Consider the platform: web fonts, system fonts on native mobile, custom fonts where appropriate

**Color & Theme**

- Commit to a cohesive aesthetic with intention
- Dominant colors with sharp accents outperform timid, evenly-distributed palettes
- Use semantic color systems for consistency across light/dark modes
- Avoid clichéd combinations (particularly purple gradients on white)
- Match palette to purpose: muted for professional tools, vibrant for creative apps, etc.

**Motion & Animation**

- Use animations for delight and clarity, not decoration
- Prioritize native animation capabilities (CSS, platform-specific APIs)
- Focus on high-impact moments: page transitions, completion states, delightful reveals
- Use staggered animations (delays) to orchestrate memorable sequences
- Respect platform conventions: iOS spring animations, Android material motion, web performance

**Spatial Composition**

- Break grids thoughtfully when it serves the design
- Use asymmetry, overlap, and diagonal flow to create interest
- Balance generous negative space OR controlled density (match the aesthetic)
- Adapt composition to screen size: dense on desktop, focused on mobile

**Backgrounds & Visual Details**

- Create depth and atmosphere rather than defaulting to solid colors
- Add contextual effects: subtle gradients, noise textures, geometric patterns
- Use layered transparencies, shadows, and borders to define hierarchy
- Match detail level to aesthetic: intricate for maximalist, restrained for minimal

**Critical Guidance**

- Match implementation complexity to the aesthetic vision
- Maximalist designs need elaborate code with extensive effects
- Minimalist designs need restraint, precision, and careful attention to subtle details
- Vary your approach: no two interfaces should converge on identical choices
- Interpret requirements creatively and make unexpected choices that fit the context

**What to Avoid**

- Generic AI aesthetics: predictable layouts, cookie-cutter components
- Overused fonts that signal "default choice" rather than intentional selection
- Patterns that lack context-specific character
- Designs that could be for anything rather than this specific purpose

## Component Libraries

**Web**: We use **shadcn/ui** as our foundation. For detailed component documentation and usage examples, refer to https://ui.shadcn.com/llms.txt

**Mobile**: Native platform components with custom styling to match the design direction

**Cross-platform**: Adapt component patterns to the platform rather than forcing uniformity. A button on iOS, Android, and web should feel native to each while maintaining brand coherence.

## Theming and Dark Mode

Every app is initialized with automatic dark mode support that responds to system preferences. Understanding how this works is critical to avoid breaking the theme system.

### How Dark Mode Works

**The System:**

- A script in `index.html` automatically adds the `dark` class to `document.body` based on the user's system color scheme preference
- The CSS uses a custom variant: `@custom-variant dark (&:is(.dark *));`
- This means dark mode styles only apply to elements that are **children** of an element with the `dark` class
- Color tokens (like `bg-background`, `text-primary`, etc.) automatically use the correct light or dark values

**CRITICAL RULE: Never manually add the `dark` class to your components**

```tsx
// ❌ WRONG - This breaks the theme system
<div className="bg-background dark">

// ✅ CORRECT - Let the system handle it
<div className="bg-background">
```

### Why This Matters

When you manually add `dark` to a component:

- Everything inside that component is forced into dark mode, regardless of the user's actual preference
- In light mode, users see dark mode colors (wrong background, wrong text colors, wrong component states)
- The automatic theme switching stops working

### Using Dark Mode Styles

The design tokens automatically adapt to the current theme. Just use them normally:

```tsx
// These automatically use the right colors for light/dark mode
<div className="bg-background text-foreground">
  <button className="bg-primary text-primary-foreground">Click me</button>
</div>
```

To style something differently in dark mode, use Tailwind's `dark:` variant:

```tsx
// Light mode: gray border, Dark mode: white/10 border
<div className="border-gray-200 dark:border-white/10">
```

### Available Color Tokens

All these tokens automatically adapt to light/dark mode:

- `background`, `foreground` - Base page colors
- `card`, `card-foreground` - Card/panel colors
- `popover`, `popover-foreground` - Popover/dropdown colors
- `primary`, `primary-foreground` - Primary action colors
- `secondary`, `secondary-foreground` - Secondary action colors
- `muted`, `muted-foreground` - Subtle/disabled content
- `accent`, `accent-foreground` - Accent highlights
- `destructive` - Destructive/dangerous actions
- `border`, `input`, `ring` - UI element boundaries

### Testing Your Theme

Always test in both light and dark mode:

1. Check your OS/browser is in light mode → verify app looks correct
2. Switch OS/browser to dark mode → verify app looks correct
3. Both should feel native and properly themed

## Media and Content

**Images**

- Use `promptAgent` to generate placeholder images (never hardcode external URLs)
- Display media scaled to show full content without cropping or distortion

**Shareable Artifacts**

- When apps generate shareable content, provide clear Share actions
- Use system share dialog when available (great for mobile and desktop)
- Share page URLs, not raw asset URLs
- Ensure shared links work for unauthenticated users unless explicitly private

**File Handling**

- Drive selection with native file inputs (hidden), present via custom UI
- Use `accept` attribute to filter file types, optional `capture` for camera/audio
- Never display raw system file inputs - wrap in polished UI

## Navigation Patterns

**Mobile**

- Bottom tab bars for primary navigation
- Internal tabs/segmented controls within screens

**Desktop**

- Sidebar or top navigation for top-level sections
- Modals and side panels for focused workflows
- Resizable panes/split views where appropriate
- Internal tabs for sub-navigation

**Both**

- Stack-based navigation for drilling into detail views
- Preserve context and emotional flow
- Hide navigation on scroll (mobile) to maximize space

## Reserved Routes

Do not use these route paths (reserved by Adaptive platform):
`assets`, `start`, `purchase`, `setup`, `admin-panel`, `remix`

## Additional Guidelines

- **No programmatic downloads**: Use native Share or visible links instead (mobile browsers often ignore download triggers)
- **Loading states**: Show skeletons during initial loads, not empty states. Disable buttons during mutations.
- **Error feedback**: Use inline feedback within the UI flow. Reserve toasts for when inline isn't practical.
