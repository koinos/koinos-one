const e = require('electron')
console.log(typeof e)
console.log(e && e.app ? 'HAS_APP' : 'NO_APP')
