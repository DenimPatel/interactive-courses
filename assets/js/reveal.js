(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var reveals = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
    var counters = Array.prototype.slice.call(document.querySelectorAll('.js-count'));
    if (!reveals.length && !counters.length) return;

    if (reduceMotion) {
      reveals.forEach(function (el) { el.classList.add('is-visible'); });
      counters.forEach(function (el) { el.textContent = el.getAttribute('data-count'); });
      return;
    }

    var seen = new Map();
    reveals.forEach(function (el) {
      if (el.style.transitionDelay) return;
      var parent = el.parentElement || document.body;
      var i = seen.get(parent) || 0;
      seen.set(parent, i + 1);
      el.style.transitionDelay = (Math.min(i, 6) * 0.05).toFixed(2) + 's';
    });

    var animateCount = function (el) {
      var target = parseInt(el.getAttribute('data-count'), 10) || 0;
      var start = performance.now();
      var duration = 900;
      var step = function (now) {
        var progress = Math.min((now - start) / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(eased * target);
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };

    if (!('IntersectionObserver' in window)) {
      reveals.forEach(function (el) { el.classList.add('is-visible'); });
      counters.forEach(animateCount);
      return;
    }

    var revealObserver = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    reveals.forEach(function (el) { revealObserver.observe(el); });

    var countObserver = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateCount(entry.target);
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });
    counters.forEach(function (el) { countObserver.observe(el); });
  });
})();