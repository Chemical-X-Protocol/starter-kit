export const buildScss = (name) => `.${name} {
  display: flex;
  flex-direction: column;
  padding: 16px;
  background: rgba(19, 30, 58, 0.7);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(98, 201, 255, 0.15);
  border-radius: 8px;

  &__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  &__title {
    margin: 0;
    font-size: 16px;
    color: #ffffff;
  }

  &__subtitle {
    margin: 4px 0 0;
    font-size: 12px;
    color: #94a3b8;
  }

  &__badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    background: #0b1329;

    &--ready { color: #62c9ff; }
    &--active { color: #4ade80; }
    &--pending { color: #facc15; }
  }

  &__body {
    margin-top: 14px;
    display: flex;
    justify-content: flex-end;
  }

  &__action {
    padding: 6px 14px;
    border-radius: 4px;
    background: #1e293b;
    border: 1px solid #334155;
    color: #ffffff;
    cursor: pointer;

    &:hover:not(:disabled) {
      background: #334155;
      border-color: #62c9ff;
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
}
`;
