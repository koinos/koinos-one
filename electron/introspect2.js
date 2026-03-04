try { console.log('binding names?'); console.log(Object.keys(process).filter(k => k.includes('binding')).slice(0,20)) } catch (e) { console.error(e) }
try { console.log('has _linkedBinding', typeof process._linkedBinding) } catch (e) { console.error(e) }
