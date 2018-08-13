const ParadiseTokenAlpha = artifacts.require("./ParadiseTokenAlpha.sol");
const MintableToken = artifacts.require("./token/MintableToken.sol");
const util = require('./util');
const expectThrow = util.expectThrow;
const getTimestampPlusSeconds = util.getTimestampPlusSeconds;
const getTimeoutPromise = util.getTimeoutPromise;
const toBytes32 = util.toBytes32;

contract('ParadiseTokenAlpha', function(accounts) {

    let LAInstance;
    let ERC20Instance;

    const _owner = accounts[0];
    const _notOwner = accounts[1];
    const _reserver = accounts[2];

    const _reservationCost = 80;
    const _reservationRefundAmountLess = _reservationCost - 20;
    const _reservationRefundAmountEqual = _reservationCost;
    const _reserverDeposit = _reservationCost / 10;    
    const _reservationTotalCost = _reservationCost + _reserverDeposit;
    const _reserverAmountEnough = _reservationTotalCost * 2;
    const _reserverAmountNotEnough = _reservationCost / 2;

    const _reservationBookingId = toBytes32("6a5d0e1c89");
    const _reservationBookingId2 = toBytes32("6a5d0e1c90");

    describe("creating contract", () => {
        it("should be able to deploy ParadiseToken Alpha Contract", async function() {
            LAInstance = undefined;
            ERC20Instance = await MintableToken.new({
                from: _owner
            });
            LAInstance = await ParadiseTokenAlpha.new(ERC20Instance.address, {
                from: _owner
            });
            assert.isDefined(LAInstance, "Could not deploy ParadiseToken Alpha contract");
        })
    })

    describe("constructor", () => {
        beforeEach(async function() {
            ERC20Instance = await MintableToken.new({
                from: _owner
            });
            LAInstance = await ParadiseTokenAlpha.new(ERC20Instance.address, {
                from: _owner
            });
        })

        it("should have set the owner of the contract", async function() {
            const LAOwner = await LAInstance.owner.call();
            assert.strictEqual(LAOwner, _owner, "The contract owner was not set correctly");
        });

        it("should have set the token contract", async function() {
            const LAERC20Address = await LAInstance.PDTTokenContract.call();
            console.log(LAERC20Address);
            assert.strictEqual(LAERC20Address, ERC20Instance.address, "The token contract was not set correctly");
        });

    });

    describe("reserving correct amount", () => {

        let reservationTimestamp;

        beforeEach(async function() {
            ERC20Instance = await MintableToken.new({
                from: _owner
            });
            LAInstance = await ParadiseTokenAlpha.new(ERC20Instance.address, {
                from: _owner
            });
            await ERC20Instance.mint(_reserver, _reserverAmountEnough, {
                from: _owner
            });
            await ERC20Instance.approve(LAInstance.address, _reserverAmountEnough, {
                from: _reserver
            })
            reservationTimestamp = getTimestampPlusSeconds(25);
        })

        it("should make reservation succesfully", async function() {
            let result = await LAInstance.reserve(
                _reservationBookingId, 
                _reservationCost, 
                reservationTimestamp, 
                _reservationRefundAmountLess,
                _reserverDeposit, {
                from: _reserver
            });

            assert.isTrue(Boolean(result.receipt.status), "The reservation was not successful");

            let reservationsCount = await LAInstance.reservationsCount.call();
            assert(reservationsCount.eq(1), "The reservation count was not correct");
        })

        it("should set the values in a reservation correctly", async function() {
            await LAInstance.reserve(
                _reservationBookingId, 
                _reservationCost, 
                reservationTimestamp, 
                _reservationRefundAmountLess,
                _reserverDeposit, {
                from: _reserver
            });

            let result = await LAInstance.bookings.call(_reservationBookingId);
            assert.strictEqual(result[0], _reserver, "The reserver was not set correctly");
            assert(result[1].eq(_reservationCost), "The cost was not set correctly");
            assert(result[2].eq(reservationTimestamp), "The deadline was not set correctly");
            assert(result[3].eq(_reservationRefundAmountLess), "The refund amount was not set correctly");
            assert(result[4].eq(_reserverDeposit), "The deposit amount was not set correctly");
            assert(result[5].eq(0), "The index array was not set correctly");
            assert.isTrue(result[6], "The reservation was not active");
        })

        it("should change the PDT balances correctly", async function() {
            const reserverBalanceBefore = await ERC20Instance.balanceOf.call(_reserver);
            const contractBalanceBefore = await ERC20Instance.balanceOf.call(LAInstance.address);
            await LAInstance.reserve(
                _reservationBookingId, 
                _reservationCost, 
                reservationTimestamp, 
                _reservationRefundAmountLess,
                _reserverDeposit, {
                from: _reserver
            });

            const reserverBalanceAfter = await ERC20Instance.balanceOf.call(_reserver);
            const contractBalanceAfter = await ERC20Instance.balanceOf.call(LAInstance.address);

            assert(reserverBalanceAfter.eq(reserverBalanceBefore.minus(_reservationTotalCost)), "The reserver balance was not correct");
            assert(contractBalanceAfter.eq(contractBalanceBefore.plus(_reservationTotalCost)), "The contract balance was not correct");
        })

        it("should throw if trying to reserve when paused", async function() {
            await LAInstance.pause({
                from: _owner
            });
            await expectThrow(LAInstance.reserve(
                _reservationBookingId, 
                _reservationCost, 
                reservationTimestamp, 
                _reservationRefundAmountLess,
                _reserverDeposit, {
                from: _reserver
            }));
        })

        it("should throw if the deadline is in the past", async function() {
            const pastDeadline = getTimestampPlusSeconds(-15);
            await expectThrow(LAInstance.reserve(
                _reservationBookingId, 
                _reservationCost, 
                pastDeadline, 
                _reservationRefundAmountLess,
                _reserverDeposit, {
                from: _reserver
            }));
        })

        it("should emit event on reservation", async function() {
            const expectedEvent = 'LogReservation';
            let result = await LAInstance.reserve(
                _reservationBookingId, 
                _reservationCost, 
                reservationTimestamp, 
                _reservationRefundAmountLess,
                _reserverDeposit, {
                from: _reserver
            });
            assert.lengthOf(result.logs, 1, "There should be 1 event emitted from reservation!");
            assert.strictEqual(result.logs[0].event, expectedEvent, `The event emitted was ${result.logs[0].event} instead of ${expectedEvent}`);
        });
    })

    describe("reserving without correct amount", () => {
        let reservationTimestamp;

        beforeEach(async function() {
            ERC20Instance = await MintableToken.new({
                from: _owner
            });
            LAInstance = await ParadiseTokenAlpha.new(ERC20Instance.address, {
                from: _owner
            });
            await ERC20Instance.mint(_reserver, _reserverAmountEnough, {
                from: _owner
            });
            reservationTimestamp = getTimestampPlusSeconds(25);
        })

        it("should throw if try to reserve without enough approval", async function() {
            await ERC20Instance.approve(LAInstance.address, _reserverAmountNotEnough, {
                from: _reserver
            })
            await expectThrow(LAInstance.reserve(
                _reservationBookingId, 
                _reservationCost,
                reservationTimestamp, 
                _reservationRefundAmountLess,
                _reserverDeposit, {
                from: _reserver
            }));
        })

        it("should throw if the user does not have enough balance", async function() {
            await ERC20Instance.approve(LAInstance.address, _reserverAmountEnough, {
                from: _reserver
            })
            await expectThrow(LAInstance.reserve(
                _reservationBookingId,
                _reservationCost * 4, 
                reservationTimestamp, 
                _reservationRefundAmountLess, 
                _reserverDeposit, {
                from: _reserver
            }));
        })
    })

    describe("canceling reservation", () => {
        let reservationTimestamp;

        beforeEach(async function() {
            ERC20Instance = await MintableToken.new({
                from: _owner
            });
            LAInstance = await ParadiseTokenAlpha.new(ERC20Instance.address, {
                from: _owner
            });
            await ERC20Instance.mint(_reserver, _reserverAmountEnough, {
                from: _owner
            });
            await ERC20Instance.approve(LAInstance.address, _reserverAmountEnough, {
                from: _reserver
            })
            reservationTimestamp = getTimestampPlusSeconds(25);
            await LAInstance.reserve(
                _reservationBookingId, 
                _reservationCost, 
                reservationTimestamp, 
                _reservationRefundAmountLess, 
                _reserverDeposit, {
                from: _reserver
            });
        })

        it("should make reservation inactive after cancel and make the count of reservations less", async function() {
            let reservationsCountBefore = await LAInstance.reservationsCount.call();

            await LAInstance.cancelBooking(_reservationBookingId, {
                from: _reserver
            });

            let result = await LAInstance.bookings.call(_reservationBookingId);

            assert(result[6] == false, "The reservation was still active");

            let reservationsCountAfter = await LAInstance.reservationsCount.call();

            assert(reservationsCountAfter.eq(reservationsCountBefore.minus(1)), "The reservation count has not changed");
        });

        it("should refund money after cancel", async function() {
            await LAInstance.reserve(
                _reservationBookingId2, 
                _reservationCost, 
                reservationTimestamp, 
                _reservationRefundAmountEqual, 
                _reserverDeposit, {
                from: _reserver
            });
            const reserverBalanceBefore = await ERC20Instance.balanceOf.call(_reserver);
            const ownerBalanceBefore = await ERC20Instance.balanceOf.call(_owner);
            await LAInstance.cancelBooking(_reservationBookingId2, {
                from: _reserver
            });
            const reserverBalanceAfter = await ERC20Instance.balanceOf.call(_reserver);
            const ownerBalanceAfter = await ERC20Instance.balanceOf.call(_owner);

            assert(reserverBalanceAfter.eq(reserverBalanceBefore.plus(_reservationRefundAmountEqual + _reserverDeposit)), "The refunded amount was not correct");
            assert(ownerBalanceAfter.eq(ownerBalanceBefore), "The contract amount was changed but it should not");
        });

        it("should refund money and send rest to owner", async function() {
            const ownerFee = _reservationCost - _reservationRefundAmountLess;
            const reserverBalanceBefore = await ERC20Instance.balanceOf.call(_reserver);
            const ownerBalanceBefore = await ERC20Instance.balanceOf.call(_owner);
            await LAInstance.cancelBooking(_reservationBookingId, {
                from: _reserver
            });
            const reserverBalanceAfter = await ERC20Instance.balanceOf.call(_reserver);
            const ownerBalanceAfter = await ERC20Instance.balanceOf.call(_owner);

            assert(reserverBalanceAfter.eq(reserverBalanceBefore.plus(_reservationRefundAmountLess + _reserverDeposit)), "The refunded amount was not correct");
            assert(ownerBalanceAfter.eq(ownerBalanceBefore.plus(ownerFee)), "The contract owner fee was not correct");
        });

        it("should throw if non reserver tries to cancel", async function() {
            await expectThrow(LAInstance.cancelBooking(_reservationBookingId, {
                from: _notOwner
            }));
        });

        it("should throw if trying to cancel when the contract is paused", async function() {
            await LAInstance.pause({
                from: _owner
            });
            await expectThrow(LAInstance.cancelBooking(_reservationBookingId, {
                from: _reserver
            }));
        });

        it("should throw if trying to cancel after deadline", async function() {
            reservationTimestamp = getTimestampPlusSeconds(2)
            await LAInstance.reserve(
                _reservationBookingId2, 
                _reservationCost, 
                reservationTimestamp, 
                _reservationRefundAmountEqual, 
                _reserverDeposit, {
                from: _reserver
            });
            await getTimeoutPromise(3);
            await expectThrow(LAInstance.cancelBooking(_reservationBookingId2, {
                from: _reserver
            }));
        });

        it("should emit event on cancelation", async function() {
            const expectedEvent = 'LogCancelation';
            let result = await LAInstance.cancelBooking(_reservationBookingId, {
                from: _reserver
            });
            assert.lengthOf(result.logs, 1, "There should be 1 event emitted from cancelation!");
            assert.strictEqual(result.logs[0].event, expectedEvent, `The event emitted was ${result.logs[0].event} instead of ${expectedEvent}`);
        });

    })

    describe("withdrawal tests", () => {
        let reservationTimestamp;

        beforeEach(async function() {
            ERC20Instance = await MintableToken.new({
                from: _owner
            });
            LAInstance = await ParadiseTokenAlpha.new(ERC20Instance.address, {
                from: _owner
            });
            await ERC20Instance.mint(_reserver, _reserverAmountEnough, {
                from: _owner
            });
            await ERC20Instance.approve(LAInstance.address, _reserverAmountEnough, {
                from: _reserver
            })
            reservationTimestamp = getTimestampPlusSeconds(0);
            await LAInstance.reserve(
                _reservationBookingId, 
                _reservationCost, 
                reservationTimestamp, 
                _reservationRefundAmountLess,
                _reserverDeposit, {
                from: _reserver
            });
        })

        it("should make reservation inactive after withdrawal and make the count of reservations less", async function() {
            let reservationsCountBefore = await LAInstance.reservationsCount.call();
            await getTimeoutPromise(1);
            await LAInstance.withdraw(_reservationBookingId, {
                from: _owner
            });

            let result = await LAInstance.bookings.call(_reservationBookingId);

            assert(result[6] == false, "The reservation was still active");

            let reservationsCountAfter = await LAInstance.reservationsCount.call();

            assert(reservationsCountAfter.eq(reservationsCountBefore.minus(2)), "The reservation count has not changed");
        });

        it("should send the money to the owner", async function() {
            const reserverBalanceBefore = await ERC20Instance.balanceOf.call(_reserver);
            const ownerBalanceBefore = await ERC20Instance.balanceOf.call(_owner);
            await getTimeoutPromise(1);
            await LAInstance.withdraw(_reservationBookingId, {
                from: _owner
            });
            const reserverBalanceAfter = await ERC20Instance.balanceOf.call(_reserver);
            const ownerBalanceAfter = await ERC20Instance.balanceOf.call(_owner);

            assert(reserverBalanceAfter.eq(reserverBalanceBefore.plus(_reserverDeposit)), "The refunded amount was not correct");
            assert(ownerBalanceAfter.eq(ownerBalanceBefore.plus(_reservationCost)), "The contract owner fee was not correct");
        });

        it("should send deposit back to the reserver", async function() {
            const reserverBalanceBefore = await ERC20Instance.balanceOf.call(_reserver);
            const ownerBalanceBefore = await ERC20Instance.balanceOf.call(_owner);
            await getTimeoutPromise(1);
            await LAInstance.withdraw(_reservationBookingId, {
                from: _owner
            });
            const reserverBalanceAfter = await ERC20Instance.balanceOf.call(_reserver);
            const ownerBalanceAfter = await ERC20Instance.balanceOf.call(_owner);

            assert(reserverBalanceAfter.eq(reserverBalanceBefore.plus(_reserverDeposit)), "The refunded amount was not correct");
        });

        it("should throw if non owner tries to withdraw", async function() {
            await getTimeoutPromise(1);
            await expectThrow(LAInstance.withdraw(_reservationBookingId, {
                from: _notOwner
            }));
        });

        it("should throw if trying to withdraw when the contract is paused", async function() {
            await LAInstance.pause({
                from: _owner
            });
            await getTimeoutPromise(1);
            await expectThrow(LAInstance.withdraw(_reservationBookingId, {
                from: _owner
            }));
        });

        it("should throw if trying to wihdraw before deadline", async function() {
            reservationTimestamp = getTimestampPlusSeconds(25)
            await LAInstance.reserve(
                _reservationBookingId2,
                _reservationCost, 
                reservationTimestamp, 
                _reservationRefundAmountEqual, 
                _reserverDeposit, {
                from: _reserver
            });
            await expectThrow(LAInstance.withdraw(_reservationBookingId2, {
                from: _owner
            }));
        });

        it("should emit event on withdrawal", async function() {
            await getTimeoutPromise(1);

            const expectedEvent = 'LogWithdrawal';
            let result = await LAInstance.withdraw(_reservationBookingId, {
                from: _owner
            });
            assert.lengthOf(result.logs, 1, "There should be 1 event emitted from withdrawal!");
            assert.strictEqual(result.logs[0].event, expectedEvent, `The event emitted was ${result.logs[0].event} instead of ${expectedEvent}`);
        });
    })

    describe("looping through tests", () => {
        let shortReservationTimestamp;
        let longReservationTimestamp;
        beforeEach(async function() {
            ERC20Instance = await MintableToken.new({
                from: _owner
            });
            LAInstance = await ParadiseTokenAlpha.new(ERC20Instance.address, {
                from: _owner
            });
            await ERC20Instance.mint(_reserver, _reserverAmountEnough, {
                from: _owner
            });
            await ERC20Instance.approve(LAInstance.address, _reserverAmountEnough, {
                from: _reserver
            })
            shortReservationTimestamp = getTimestampPlusSeconds(0);
            await LAInstance.reserve(
                _reservationBookingId, 
                _reservationCost, 
                shortReservationTimestamp, 
                _reservationRefundAmountLess, 
                _reserverDeposit, {
                from: _reserver
            });
            longReservationTimestamp = getTimestampPlusSeconds(25);
            await LAInstance.reserve(_reservationBookingId2, 
                _reservationCost, 
                longReservationTimestamp, 
                _reservationRefundAmountLess, 
                _reserverDeposit, {
                from: _reserver
            });
        })

        it("should find the completed reservation", async function() {
            let reservationsCount = await LAInstance.reservationsCount.call();
            reservationsCount = reservationsCount.toNumber();

            await getTimeoutPromise(1);

            const now = getTimestampPlusSeconds(0);

            const result = new Array();

            for (let i = 0; i < reservationsCount; i++) {
                let reservationId = await LAInstance.bookingIds.call(i);
                let reservation = await LAInstance.bookings.call(reservationId);
                if (reservation[2].lte(now)) {
                    result.push(reservationId);
                }
            }

            assert.lengthOf(result, 1, "There should be 1 reservation found!");
            assert.strictEqual(result[0], _reservationBookingId, "The wrong reservation was found");
        })
    })

});
