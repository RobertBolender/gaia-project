<template>
  <div class="move-button">
    <Booster
      v-if="button.booster"
      class="mb-1 mr-1"
      @click.native="handleClick"
      :booster="button.booster"
      highlighted
    />
    <TechTile v-else-if="button.tech" class="mb-1 mr-1" @click="handleClick" :pos="button.tech" :count-override="1" />
    <b-btn
      v-else-if="!button.times"
      :variant="button.warning ? 'warning' : 'secondary'"
      class="mr-2 mb-2 move-button"
      @click="handleClick"
      @mouseenter="hover"
      @mouseleave="leave"
      :title="tooltip"
      v-b-tooltip.html
      v-html="customLabel || button.label || button.command"
    >
    </b-btn>
    <b-dropdown
      class="mr-2 mb-2 move-button"
      v-else
      split
      right
      :text="customLabel || button.label || button.command"
      @click="handleRangeClick(button.times[0])"
    >
      <b-dropdown-item v-for="i in button.times" :key="i" @click="handleRangeClick(i)">{{ i }}</b-dropdown-item>
    </b-dropdown>
    <b-modal
      v-if="button.modal"
      v-model="modalShow"
      size="lg"
      @ok="handleOK"
      @hide="modalCancel"
      dialog-class="gaia-viewer-modal"
      :title="button.title || button.label || button.command"
      ok-title="OK, I pick this one!"
    >
      <div v-html="button.modal"></div>
    </b-modal>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import { Component, Prop } from "vue-property-decorator";
import { BuildWarning, GaiaHex, HighlightHex, SpaceMap } from "@gaia-project/engine";
import { ButtonData, HighlightHexData } from "../data";
import Booster from "./Booster.vue";
import TechTile from "./TechTile.vue";

@Component({
  components: {
    Booster,
    TechTile,
  },
})
export default class MoveButton extends Vue {
  @Prop()
  public button!: ButtonData;

  private subscription: () => {} | null = null;
  private modalShow = false;
  private customLabel = "";
  private startingHex = null; // For range command

  modalCancel(arg: string) {
    this.$emit("cancel");
  }

  subscribe(action: string, callback: any) {
    action = "gaiaViewer/" + action;

    this.unsubscribe();
    this.$store.commit("gaiaViewer/activeButton", this.button);

    this.subscription = (this.$store as any).subscribeAction(({ type, payload }) => {
      if (type !== action) {
        return;
      }

      if (!this.isActiveButton) {
        return;
      }

      console.log(type, payload);

      callback(payload);
    });
  }

  subscribeHexClick(callback: (hex: GaiaHex, highlight: HighlightHex) => void) {
    this.subscribe("hexClick", payload => {
      callback(payload.hex, payload.highlight);
    });
  }

  subscribeFinal(action: string) {
    this.subscribe(action, (field) => this.emitCommand(field, { final: true }));
    this.emitCommand(null, { disappear: false });
  }

  unsubscribe() {
    if (this.subscription) {
      this.subscription();
    }
  }

  destroyed() {
    this.unsubscribe();
  }

  async handleClick() {
    if (this.button.hide) {
      console.log("click on hidden button, ignoring");
      return;
    }
    const warning = this.button.warning;
    if (warning) {
      try {
        const c = this.$createElement;
        const message = warning.body.length == 1 ? warning.body[0] :
          warning.body.map(w => c("ul", [c("li", [w])]));
        const okClicked = await this.$bvModal.msgBoxConfirm(message, {
          title: warning.title,
          headerClass: "warning",
          okTitle: warning.okButton?.label,
        });

        if (okClicked) {
          const action = warning.okButton?.action;
          if (action) {
            action();
            return;
          }
        } else {
          return;
        }
      } catch (err) {
        console.error(err);
        return;
      }
    }
    // Remove highglights caused by another button
    if (!this.isActiveButton) {
      this.$store.commit("gaiaViewer/clearContext");
    }
    if (
      this.button.hexes &&
      !this.button.selectHexes &&
      !this.button.hover &&
      !this.button.rotation &&
      !this.button.range
    ) {
      if (this.button.automatic && this.button.hexes.size === 1) {
        const hex = this.button.hexes.keys().next().value;
        this.emitCommand(hex.toString());
      } else {
        this.$store.commit("gaiaViewer/highlightHexes", this.button.hexes);
        this.subscribeHexClick((hex, highlight) => {
          if (this.button.needConfirm) {
            this.$store.commit("gaiaViewer/highlightHexes", new Map<GaiaHex, HighlightHex>([[hex, {}]]));
          }

          this.emitCommand(hex.toString(), { warnings: highlight.warnings });
        });
      }
    } else if (this.button.researchTiles) {
      this.$store.commit("gaiaViewer/highlightResearchTiles", this.button.researchTiles);
      this.subscribeFinal("researchClick");
    } else if (this.button.techs) {
      this.$store.commit("gaiaViewer/highlightTechs", this.button.techs);
      this.subscribeFinal("techClick");
    } else if (this.button.actions) {
      this.$store.commit("gaiaViewer/highlightActions", this.button.actions);
      this.subscribeFinal("actionClick");
    } else if (this.button.needConfirm) {
      this.emitCommand(null, { disappear: false });
    } else if (this.button.selectHexes) {
      // If already the active button, end the selection
      if (this.isActiveButton) {
        this.button.command = [...this.$store.state.gaiaViewer.context.highlighted.hexes.keys()]
          .map((hex) => hex.toString())
          .join(",");
        this.emitCommand();
        return;
      }

      this.$store.commit("gaiaViewer/selectHexes", this.button.hexes);

      this.customLabel = "Custom location - End selection";

      this.subscribeHexClick((hex) => {
        const highlighted = this.$store.state.gaiaViewer.context.highlighted.hexes;

        if (highlighted.has(hex)) {
          highlighted.delete(hex);
        } else {
          highlighted.set(hex, null);
        }

        const keys: GaiaHex[] = [...highlighted.keys()];
        this.$store.commit("gaiaViewer/highlightHexes", new Map([...keys.map((key) => [key, null])] as any));
      });
    } else if (this.button.modal) {
      this.modalShow = true;
    } else if (this.button.rotation) {
      if (this.isActiveButton) {
        const rotations = [...this.$store.state.gaiaViewer.context.rotation.entries()];
        for (const rotation of rotations) {
          rotation[1] %= 6;
        }
        this.emitCommand([].concat(...rotations.filter((r) => !!r[1])).join(" "));
        return;
      }

      this.$store.commit("gaiaViewer/highlightHexes", this.button.hexes);
      this.subscribeHexClick((hex) => this.$store.commit("gaiaViewer/rotate", hex));
      this.customLabel = "Sector rotations finished";
    } else if (this.button.range) {
      console.log("range click");
      this.$store.commit("gaiaViewer/highlightHexes", this.button.hexes);
      this.subscribeHexClick((hex) => {
        if (this.startingHex) {
          this.emitCommand(`${this.startingHex} ${hex}`);
          this.startingHex = undefined;
          return;
        }
        this.startingHex = hex;

        const map: SpaceMap = this.$store.state.gaiaViewer.data.map;
        const { range, costs } = this.button;

        const highlighted = new Map();

        const withinDistance = map.withinDistance(hex, range);
        for (const target of withinDistance) {
          highlighted.set(target, { cost: costs?.[map.distance(hex, target)] ?? "~" });
        }

        this.$store.commit("gaiaViewer/highlightHexes", highlighted);
      });
    } else {
      // Keep hexes highlighted for next command (federation tile)
      if (this.button.hexes && this.button.hover) {
        this.$store.commit("gaiaViewer/highlightHexes", this.button.hexes);
      }
      this.emitCommand();
    }
  }

  handleRangeClick(times: number) {
    this.emitCommand(null, { times });
  }

  handleOK() {
    this.emitCommand();
  }

  emitCommand(
    append?: string,
    params?: { disappear?: boolean; final?: boolean; times?: number; warnings?: BuildWarning[] }
  ) {
    console.log("emit command", this.button.command, append);

    if (this.button.needConfirm && append) {
      this.button.buttons[0].command = append;
    }

    params = Object.assign({}, { disappear: true, final: false, times: 1 }, params);
    const { disappear, final, times, warnings } = params;

    if (disappear) {
      this.unsubscribe();

      this.$store.commit("gaiaViewer/activeButton", null);
    }

    let commandBody: string[] = [];

    if (final) {
      commandBody = append ? [append] : [];
    } else {
      // Parse numbers, ie the command is executed X times, multiply
      // each number by X instead of repeating the command X times.
      let command = (this.button.command || "") + "";

      if (times && typeof times === "number") {
        // the \b is necessary for things like '1t-a3', so the 3 is not caught
        command = command.replace(/\b[0-9]+/g, (x) => "" + parseInt(x) * times);
      }

      command = command.replace(/\$times\b/g, "" + (times ?? 0));

      commandBody = [command, append].filter((x) => !!x);
    }

    this.$emit("trigger", commandBody.join(" "), this, final, warnings);
  }

  get tooltip(): string | null {
    return this.button.tooltip ?? this.button.warning?.body?.join(', ');
  }

  hover() {
    if (!this.button.hover || this.$store.state.gaiaViewer.context.activeButton !== null) {
      return;
    }

    this.$store.commit("gaiaViewer/highlightHexes", this.button.hexes);
  }

  leave() {
    if (!this.button.hover || this.$store.state.gaiaViewer.context.activeButton !== null) {
      return;
    }

    this.$store.commit("gaiaViewer/clearContext");
  }

  get isActiveButton() {
    return (
      this.$store.state.gaiaViewer.context.activeButton &&
      this.$store.state.gaiaViewer.context.activeButton.label === this.button.label
    );
  }
}
</script>

<style lang="scss">
.move-button {
  display: inline-block;
}

.warning {
  background-color: var(--warning);
}
</style>
