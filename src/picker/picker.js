let allSources = [];
let activeTab = "screens"; // "screens" | "windows"

const list = document.getElementById("sources");
const tabScreens = document.getElementById("tab-screens");
const tabWindows = document.getElementById("tab-windows");
const cancelBtn = document.getElementById("cancel");

function renderSources() {
  list.replaceChildren();

  const isScreenTab = activeTab === "screens";
  const filtered = allSources.filter((s) =>
    isScreenTab ? s.id.startsWith("screen:") : s.id.startsWith("window:")
  );

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = isScreenTab
      ? "No screens available."
      : "No application windows available.";
    list.append(empty);
    return;
  }

  for (const source of filtered) {
    const card = document.createElement("button");
    card.className = "source-card";
    card.type = "button";
    card.setAttribute("title", source.name);

    const thumb = document.createElement("img");
    thumb.className = "source-thumb";
    thumb.src = source.thumbnail;
    thumb.alt = source.name;

    const title = document.createElement("div");
    title.className = "source-title";
    title.textContent = source.name;

    card.append(thumb, title);
    card.addEventListener("click", () => {
      window.capturePicker.choose(source.id);
    });

    list.append(card);
  }

  list.querySelector("button")?.focus();
}

function setTab(tab) {
  activeTab = tab;
  if (tab === "screens") {
    tabScreens.classList.add("active");
    tabWindows.classList.remove("active");
  } else {
    tabScreens.classList.remove("active");
    tabWindows.classList.add("active");
  }
  renderSources();
}

tabScreens.addEventListener("click", () => setTab("screens"));
tabWindows.addEventListener("click", () => setTab("windows"));

window.capturePicker.onSources((sources) => {
  allSources = Array.isArray(sources) ? sources : [];
  renderSources();
});

cancelBtn.addEventListener("click", () => window.capturePicker.choose(null));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    void window.capturePicker.choose(null);
  }
});
