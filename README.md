# Chemical X Protocol: Starter Kit

Modular architecture blueprint and drop-in component capsule generator.

## Structure

```
starter-kit/
├── blueprints/
│   ├── view-template.tsx       # < 20 line Table-of-Contents view blueprint
│   ├── molecule-capsule/       # Isolated crystalline molecule blueprint
│   └── composable-template.ts  # Standardized 3-to-5 return state composable
├── hooks/
│   ├── useAsyncData.ts         # 3-state async pipeline with toResult
│   ├── useSelfCleaningTimer.ts # Unmount-safe timer and RAF hook
│   └── useTwoStageDecision.ts  # Concept to Decision composition
└── cli/
    └── index.js                # Interactive capsule generator
```

## Licensing

Unlocked for verified GitHub Sponsors of `chemical-x-protocol`.
