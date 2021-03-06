var decircularize = require('decircularize')
var isFake = require('./is-fake')

function isResettable(fake) {
	if(!isFake(fake)) return false

	return typeof(fake.restore) === 'function'
		&& typeof(fake.reset) === 'function'
}

module.exports = createFake

var __slice = Array.prototype.slice
var __find = Array.prototype.find || function find(fn, ctx) {
	var l = this.length
	for(var i = 0; i < l; i++) {
		var o = this[i]
		if(fn.call(ctx, o, i, this)) {
			return o
		}
	}
	return null
}
var __map = Array.prototype.map

function noop() {}

function createFake(target, property) {
	var action = null
	var calls = []
	var unhandledCalls = []
	var constrainedFakes = []
	constrainedFakes.find = function(fn) {
		var result = __find.call(this, fn)
		return result && result.fake
	}

	var fake = function() {
		var args = __slice.call(arguments)
		var act = constrainedFakes.find(function(f) {
			return f.args.every(function(arg, i) {
				if(!arg) return true
				var val = args[i]
				if(arg.regex) return typeof(val) == 'string' && arg.regex.test(val)
				if(arg.value) return compareObjects(arg.value, val)
				return true
			})
		}) || action
		calls.push(args)
		if(!act) {
			unhandledCalls.push(args)
			return
		}
		return act.apply(this, args)
	}
	Object.defineProperty(fake, 'callCount', {
		get: function() { return calls.length }
	})
	Object.defineProperty(fake, '_calls', {
		get: function() { return calls }
	})
	fake.calls = function(fn, options) {
		if(options && options.now) {
			var lastCall = unhandledCalls.shift()
			if(!lastCall) {
				throw new Error('No unhandled calls registered on the fake')
			}
			fn.apply(null, lastCall)
			return this
		}
		action = fn
		return this
	}
	fake.callsArg = function(options) {
		var getCallback
		function __matchFunction(arg) {
			return typeof(arg) === 'function'
		}
		function extendGetCallback(fn) {
			getCallback = function(internalGetCB, args) {
				var cb = internalGetCB(args)
				return function() {
					var args = __slice.call(arguments)
					return fn(cb, args)
				}
			}.bind(null, getCallback)
		}
		if(!options) options = {}
		switch(options.arg) {
			case 'first':
				getCallback = function(args) {
					return __find.call(args, __matchFunction) || noop
				}
				break
			case 'last':
			default:
				getCallback = typeof(options.arg) == 'number'
				? function(args) { return args[options.arg] }
				: function(args) {
					return __find.call(args.slice().reverse(), __matchFunction) || noop
				}
		}
		if(options.notify) {
			extendGetCallback(function(cb, args) {
				var result
				try {
					result = cb.apply(null, args)
				} catch(error) {
					options.notify(error)
					throw error
				}
				result = options.notify(null, result)
				return options.returns || result
			})
		} else {
			extendGetCallback(function(cb, args) {
				cb.apply(null, args)
			})
		}
		if(options.async) {
			extendGetCallback(function(cb, args) {
				process.nextTick(function() {
					cb.apply(null, args)
				})
			})
		}
		return this.calls(function() {
			var args = __slice.call(arguments)
			var callback = getCallback(args)
			var result = callback.apply(null, options.arguments || [])
			return options.returns || result
		}, { now: options.now })
	}
	fake.returns = function(val) {
		return this.calls(function() { return val })
	}
	fake.throws = function(val) {
		return this.calls(function() { throw val || new Error })
	}
	fake.wasCalled = function() {
		return !!fake.callCount
	}
	fake.wasCalledWith = function() {
		var args = __slice.call(arguments)
		args.forEach(function(x) { assertNotCircular(x) })
		return calls.some(function(call) {
			return compareArrays(args, call)
		})
	}
	fake.wasCalledWithExactly = function() {
		var args = __slice.call(arguments)
		args.forEach(function(x) { assertNotCircular(x) })
		return calls.some(function(call) {
			return call.length == args.length && compareArrays(args, call)
		})
	}
	fake.withArgs = function() {
		return this.withComplexArgs.apply(this, __map.call(arguments, function(val) { return { value: val } }))
	}
	fake.withComplexArgs = function() {
		var args = __slice.call(arguments)
		args.forEach(function(x) { assertNotCircular(x) })
		var newFake = constrainedFakes.find(function(f) {
			if(f.args.length != args.length) {
				return false
			}
			return compareArrays(f.args, args)
		})
		if(newFake) {
			return newFake
		}
		newFake = createFake()
		constrainedFakes.push(
		{ args: args
		, fake: newFake
		})
		constrainedFakes.sort(constrainedFakesSorter)
		var oldCalls = newFake.calls
		newFake.calls = function() {
			oldCalls.apply(this, arguments)
			return fake
		}
		return newFake
	}
	fake.callsOriginal = function(options) {
		return this.calls(original, options)
	}

	fake.restore = function() {
		if(target && property) {
			target[property] = original
			target = null
			property = null
		}
	}
	fake.reset = function() {
		calls = []
		unhandledCalls = []
		action = null
		while(constrainedFakes.length) constrainedFakes.pop()
	}

	var original
	fake._name = 'fake'
	if(target) {
		if(property) {
			fake._name = property
			original = target[property]
			if(original !== undefined && typeof(original) != 'function') {
				throw new Error('Property `' + property + '` on `'
					+ JSON.stringify(target)  + '` is not a function.')
			}

			target[property] = fake
			if(original && isResettable(original) && original._willRestore) {
				var originalRestore = original.restore
				original.restore = function() {
					target = null
					property = null
					return originalRestore.apply(this, arguments)
				}
			}
		} else if(typeof(target) == 'function') {
			original = target
			fake._name = target.name
			fake.callsOriginal()
		} else {
			fake._name = target
		}
	}

	fake._willRestore = !!(target && property)

	return fake
}

function compareObjects(a, b) {
	if(typeof(a) !== typeof(b)) {
		return false
	}

	switch(typeof(a)) {
		case 'object':
			if(a == null) {
				return a === b
			}

			if(b == null) return false

			if(a instanceof RegExp && b instanceof RegExp) {
				return a.toString() === b.toString()
			}

			return Object.keys(a).every(function(prop) {
				return compareObjects(a[prop], b[prop])
			})
		default:
			return a === b
	}
}

function compareArrays(a, b) {
	return compareObjects(a, b)
}

function constrainedFakesSorter(a, b) {
	return b.args.length - a.args.length
}

function assertNotCircular(value) {
	decircularize(value, { onCircular: function() {
		throw new Error('The use of circular structures in the tests are not supported')
	} })
}
