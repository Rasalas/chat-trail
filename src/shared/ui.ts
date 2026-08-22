export async function withBusy(
  buttons: HTMLButtonElement[],
  showStatus: (text: string, isError?: boolean) => void,
  label: string,
  task: () => Promise<void>
): Promise<void> {
  buttons.forEach((button) => {
    button.disabled = true;
  });
  showStatus(label);
  try {
    await task();
  } catch (error) {
    showStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}
