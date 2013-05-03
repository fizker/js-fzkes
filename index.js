module.exports =
{ fake: createFake
}

function createFake() {
	var action = function() {}
	var fake = function() {
		return action.apply(this, arguments)
	}
	fake.calls = function(fn) {
		action = fn
	}
	fake.returns = function(val) {
		this.calls(function() { return val })
	}
	fake.throws = function(val) {
		this.calls(function() { throw val || new Error })
	}
	return fake
}