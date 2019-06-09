(function() {
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
    // strings.
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

  function go() {

    let orgAtDates = Org.orgs(window.org_history);

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

    let diagonal = d3
      .linkHorizontal()
      .x(d => d.y)
      .y(d => d.x);

    let dateParser = d3.timeParse("%Y-%m-%d");

    let xScale = d3
      .scaleTime()
      .domain([
        d3.min(orgAtDates, d => dateParser(d.date)),
        d3.max(orgAtDates, d => dateParser(d.date))
      ])
      .range([0, width - (margin.left + margin.right)]);

    let xAxis = d3.axisBottom(xScale);

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

    d3.select("#chart")
      .select("svg")
      .append("g")
      .attr("id", "timeline")
      .attr(
        "transform",
        "translate(" + margin.left + "," + (height - roomForAxis) + ")"
      )
      .call(xAxis);

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

    let currentOrg = null;

    function updateTree(root, duration) {
      setupNodes(root, duration);
      setupLinks(root, duration);
    }

    function setupNodes(root, duration) {
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

    function setupLinks(root, duration) {
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

    function setupTimeline(orgs) {
      orgs.forEach(function(d, i) {
        d.index = i;
      });

      let ticks = d3
        .select("#timeline")
        .selectAll("g.tick")
        .data(orgs, d => d.date);

      ticks
        .enter()
        .append("g")
        .attr("class", "tick")
        .attr(
          "transform",
          d => "translate(" + xScale(dateParser(d.date)) + ",0)"
        )
        .append("circle")
        .attr("r", 4)
        .style("fill", "#fff")
        .on("click", function(e, i) {
          showOrg(i);
        });
    }

    function updateTimeline() {
      d3.select("#timeline")
        .selectAll("g.tick")
        .selectAll("circle")
        .style("fill", d =>
          d.date == currentOrg.date ? "lightsteelblue" : "#fff"
        );
    }

    function collapse(x, y) {
      let p = { x: x, y: y };
      return diagonal({ source: p, target: p });
    }

    function countPeople(org) {
      let c = 1;
      for (const child of org.children) {
        c += countPeople(child);
      }
      return c;
    }

    function showOrg(i) {
      currentOrg = orgAtDates[i];

      showDateAndCount(currentOrg);

      let org = d3.hierarchy(currentOrg);
      org.x0 = height / 2;
      org.y0 = 0;

      updateTree(tree(org), 750);
      updateTimeline();
    }

    function showDateAndCount(org) {
      let fmt = d3.timeFormat("%B %-d, %Y");
      let count = countPeople(currentOrg);

      dateLabel.text(fmt(dateParser(org.date)) + " (" + count + " people)");
    }

    function findCurrentOrgIndex(orgAtDates) {
      let now = new Date();
      let index = -1;
      for (let i = 0; i < orgAtDates.length; i++) {
        if (dateParser(orgAtDates[i].date) < now) {
          index = i;
        }
      }
      return index == -1 ? orgAtDates.length - 1 : index;
    }

    function changeOrg(e) {
      let nOrgs = orgAtDates.length;

      if (e.keyCode == 39) {
        showOrg((currentOrg.index + 1) % nOrgs);
      } else if (e.keyCode == 37) {
        showOrg((((currentOrg.index - 1) % nOrgs) + nOrgs) % nOrgs);
      }
    }

    setupTimeline(orgAtDates);
    showOrg(findCurrentOrgIndex(orgAtDates));
    document.addEventListener("keydown", changeOrg, false);
  }

  document.addEventListener("DOMContentLoaded", go);

})();
