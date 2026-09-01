import type { Command, CommandId } from "../core/commands.js";

/**
 * The context menu.
 *
 * It is opened rarely — a right click, not a keystroke — so it earns a short
 * entrance: a scale from where the pointer was, which is what makes a popup
 * feel attached to the thing that opened it rather than dropped on top of the
 * page. Anything opened hundreds of times a day would get no animation at all.
 *
 * Positioning is the fiddly part. A menu opened near the right or bottom edge
 * has to flip back inside the window, and it has to do that after measuring
 * itself, because its height depends on how many commands the selection
 * actually offers.
 */
export class ContextMenu {
  private readonly root: HTMLDivElement;
  private open = false;

  constructor(private readonly onChoose: (id: CommandId) => void) {
    this.root = document.createElement("div");
    this.root.className = "menu";
    this.root.hidden = true;
    this.root.setAttribute("role", "menu");
    document.body.append(this.root);

    this.root.addEventListener("mousedown", (event) => {
      // Keep the grid's focus: a menu that steals it makes the next key press
      // go nowhere, which reads as the app freezing.
      event.preventDefault();
      // And keep this press away from the dismiss handler below. Without it the
      // menu closes on the press and the click never lands on the item, so the
      // menu looks like it works and does nothing at all.
      event.stopPropagation();
    });

    this.root.addEventListener("click", (event) => {
      const item = (event.target as HTMLElement).closest(
        "[data-command]",
      ) as HTMLElement | null;
      if (item === null || item.hasAttribute("disabled")) return;
      const id = item.dataset["command"] as CommandId;
      this.hide();
      this.onChoose(id);
    });

    window.addEventListener("mousedown", () => this.hide());
    window.addEventListener("resize", () => this.hide());
    window.addEventListener("blur", () => this.hide());
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") this.hide();
      },
      true,
    );
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Show a set of command groups at a point, separated by a rule. */
  show(groups: readonly (readonly Command[])[], x: number, y: number): void {
    const items = groups.filter((group) => group.length > 0);
    if (items.length === 0) return;

    this.root.replaceChildren();
    items.forEach((group, index) => {
      if (index > 0) {
        const rule = document.createElement("div");
        rule.className = "menu__rule";
        this.root.append(rule);
      }
      for (const command of group) this.root.append(this.item(command));
    });

    // Measure before placing: the height depends on the commands offered.
    this.root.hidden = false;
    this.root.style.left = "0px";
    this.root.style.top = "0px";
    const box = this.root.getBoundingClientRect();
    const left = Math.max(4, Math.min(x, window.innerWidth - box.width - 4));
    const top = Math.max(4, Math.min(y, window.innerHeight - box.height - 4));

    this.root.style.left = `${left}px`;
    this.root.style.top = `${top}px`;
    this.root.style.transformOrigin = `${x - left}px ${y - top}px`;
    this.root.classList.add("is-open");
    this.open = true;
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove("is-open");
    this.root.hidden = true;
  }

  private item(command: Command): HTMLElement {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "menu__item";
    node.dataset["command"] = command.id;
    node.setAttribute("role", "menuitem");
    if (!command.enabled) node.setAttribute("disabled", "");

    const label = document.createElement("span");
    label.textContent = command.label;
    node.append(label);

    if (command.hint !== undefined) {
      const hint = document.createElement("span");
      hint.className = "menu__hint";
      hint.textContent = command.hint;
      node.append(hint);
    }
    return node;
  }
}
