(function() {
  // Parser for the dates in org_history.js.
  let dateParser = d3.timeParse("%Y-%m-%d");

  // Closure to assign ids to nodes. Will break if two people have the
  // same name. Which is kind of inherent in the current input data as
  // there's no way to distinguish between a new person with the same
  // name as an existing person or an existing person changing
  // managers.
  let assignId = (function() {
    let id_counter = 1;
    let ids = {};

    return function(d) {
      let name = d.data.name;
      if (!ids[name]) {
        ids[name] = id_counter++;
      }
      d.id = ids[name];
      return d.id;
    };
  })();

  //
  // Org type used for building up the org as people move around.
  //

  function Org() {
    this.nodes = {};
  }

  Org.prototype.update = function(name, old_boss, boss) {
    if (old_boss in this.nodes) {
      old = this.nodes[old_boss];
      old.children = old.children.filter(c => c.name != name);
    }
    if (boss === "LEFT") {
      delete this.nodes[name];
    } else {
      this.ensure(boss).children.push(this.ensure(name));
    }
  };

  Org.prototype.ensure = function(name) {
    if (!(name in this.nodes)) {
      this.nodes[name] = { name: name, children: [] };
    }
    return this.nodes[name];
  };

  Org.prototype.root = function() {
    let no_bosses = new Set(Object.keys(this.nodes));
    for (const node of Object.values(this.nodes)) {
      for (const report of node.children) {
        no_bosses.delete(report.name);
      }
    }
    if (no_bosses.size > 1) {
      throw new Error("too many roots: " + [...no_bosses]);
    }
    if (no_bosses.size == 0) {
      throw new Error("No, root! Everyone has a boss.");
    }

    // Quick and dirty clone: all our values are maps, lists, and
    // strings so this is fine if not the most elegant.
    return JSON.parse(JSON.stringify(this.nodes[[...no_bosses][0]]));
  };

  Org.prototype.on_date = function(date) {
    return { date: date, ...this.root() };
  };

  Org.orgs = function(history) {
    let bosses = {};
    let org = new Org();
    let orgs = [];

    for (const date of Object.keys(history).sort()) {
      for (const change of history[date]) {
        let [name, boss] = change.split("->").map(x => x.trim());
        org.update(name, bosses[name], boss);
        bosses[name] = boss;
      }
      orgs.push(org.on_date(date));
    }
    return orgs;
  };

  //
  // Main renderig function.
  //

  function renderOrgchart(orgAtDates) {
    let chart = document.getElementById("chart");

    let size = {
      width: chart.clientWidth,
      height: window.innerHeight || document.body.clientHeight
    };

    let margin = { top: 20, right: 20, bottom: 20, left: 20 };
    let width = size.width - (margin.right + margin.left);
    let height = size.height - (margin.top + margin.bottom);
    let leftTreePadding = 100;
    let roomForAxis = 25;
    let axisPadding = 50;

    let tree = d3
      .tree()
      .size([height - (roomForAxis + axisPadding), width - leftTreePadding]);

    let xScale = d3
      .scaleTime()
      .domain([
        d3.min(orgAtDates, d => dateParser(d.date)),
        d3.max(orgAtDates, d => dateParser(d.date))
      ])
      .range([0, width - (margin.left + margin.right)]);

    let svg = d3
      .select("#chart")
      .append("svg")
      .attr("width", width)
      .attr("height", height);

    let gTree = svg
      .append("g")
      .attr("id", "tree")
      .attr(
        "transform",
        "translate(" + (margin.left + leftTreePadding) + "," + margin.top + ")"
      );

    let dateLabel = svg
      .append("text")
      .attr("x", 20)
      .attr("y", 20)
      .attr("class", "datelabel");

    svg
      .append("g")
      .attr("id", "timeline")
      .attr(
        "transform",
        "translate(" + margin.left + "," + (height - roomForAxis) + ")"
      )
      .call(d3.axisBottom(xScale));

    function showOrg(i) {
      let org = orgAtDates[i];

      let h = d3.hierarchy(org);
      h.x0 = height / 2;
      h.y0 = 0;

      showDateAndCount(org, dateLabel);
      updateTree(tree(h), 750, gTree);
      updateTimeline(org);
      return org;
    }

    function changeOrg(e) {
      let nOrgs = orgAtDates.length;
      if (e.keyCode == 39) {
        currentOrg = showOrg((currentOrg.index + 1) % nOrgs);
      } else if (e.keyCode == 37) {
        currentOrg = showOrg(
          (((currentOrg.index - 1) % nOrgs) + nOrgs) % nOrgs
        );
      }
    }

    setupTimeline(orgAtDates, xScale, height, showOrg);
    let currentOrg = showOrg(findPresentOrgIndex(orgAtDates));
    document.addEventListener("keydown", changeOrg, false);
  }

  //
  // Helper functions for rendering the org chart.
  //

  function findPresentOrgIndex(orgAtDates) {
    let now = new Date();
    let index = -1;
    for (let i = 0; i < orgAtDates.length; i++) {
      if (dateParser(orgAtDates[i].date) < now) {
        index = i;
      }
    }
    return index == -1 ? orgAtDates.length - 1 : index;
  }

  function countPeople(org) {
    let c = 1;
    for (const child of org.children) {
      c += countPeople(child);
    }
    return c;
  }

  function showDateAndCount(org, label) {
    let fmt = d3.timeFormat("%B %-d, %Y");
    let count = countPeople(org);
    label.text(fmt(dateParser(org.date)) + " (" + count + " people)");
  }

  function updateTree(root, duration, gTree) {
    setupNodes(root, duration, gTree);
    setupLinks(root, duration, gTree);
  }

  function updateTimeline(org) {
    d3.select("#timeline")
      .selectAll("g.tick")
      .selectAll("circle")
      .style("fill", d => (d.date == org.date ? "lightsteelblue" : "#fff"));
  }

  function setupNodes(root, duration, gTree) {
    let nodeData = root.descendants();
    nodeData.forEach(function(d) {
      d.y = d.depth * 200;
    });
    let nodes = gTree.selectAll("g.node").data(nodeData, assignId);

    let enter = nodes
      .enter()
      .append("g")
      .attr("class", "node")
      .attr("transform", d => "translate(" + root.y0 + "," + root.x0 + ")");

    enter
      .append("circle")
      .attr("r", 1e-6)
      .style("fill", d => (d._children ? "lightsteelblue" : "#fff"));

    enter
      .append("text")
      .attr("dy", ".35em")
      .attr("x", d => (d.children || d._children ? -10 : 10))
      .attr("text-anchor", d => (d.children || d._children ? "end" : "start"))
      .text(d => d.data.name);

    let update = enter.merge(nodes);

    update
      .transition()
      .duration(duration)
      .attr("transform", d => "translate(" + d.y + "," + d.x + ")");

    update.select("circle").attr("r", 4.5);

    update
      .select("text")
      .attr("x", d => (d.children || d._children ? -10 : 10))
      .attr("text-anchor", d => (d.children || d._children ? "end" : "start"))
      .style("fill-opacity", 1);

    nodes
      .exit()
      .transition()
      .duration(duration)
      .attr("transform", d => "translate(" + root.y + "," + root.x + ")")
      .remove();

    nodeData.forEach(function(d) {
      d.x0 = d.x;
      d.y0 = d.y;
    });
  }

  function setupLinks(root, duration, gTree) {
    let links = gTree
      .selectAll("path.link")
      .data(root.descendants().slice(1), d => d.id);

    let enter = links
      .enter()
      .insert("path", "g")
      .attr("class", "link")
      .attr("d", d => collapse(root.x0, root.y0));

    enter
      .merge(links)
      .transition()
      .duration(duration)
      .attr("d", d => diagonal({ source: d, target: d.parent }));

    links
      .exit()
      .transition()
      .duration(duration)
      .attr("d", d => collapse(root.x, root.y))
      .remove();
  }

  let diagonal = d3
    .linkHorizontal()
    .x(d => d.y)
    .y(d => d.x);

  function collapse(x, y) {
    let p = { x: x, y: y };
    return diagonal({ source: p, target: p });
  }

  function setupTimeline(orgAtDates, xScale, showOrg) {
    orgAtDates.forEach(function(d, i) {
      d.index = i;
    });

    let ticks = d3
      .select("#timeline")
      .selectAll("g.tick")
      .data(orgAtDates, d => d.date);

    ticks
      .enter()
      .append("g")
      .attr("class", "tick")
      .attr("transform", d => "translate(" + xScale(dateParser(d.date)) + ",0)")
      .append("circle")
      .attr("r", 4)
      .style("fill", "#fff")
      .on("click", (e, i) => showOrg(i));
  }

  document.addEventListener("DOMContentLoaded", function() {
    renderOrgchart(Org.orgs(window.org_history));
  });
})();
