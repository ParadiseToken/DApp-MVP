pragma solidity ^0.4.21;

/**
 * @title SafeMath
 * @dev Math operations with safety checks that throw on error
 */
library SafeMath {
  function mul(uint256 a, uint256 b) internal pure returns (uint256) {
    if (a == 0) {
      return 0;
    }
    uint256 c = a * b;
    assert(c / a == b);
    return c;
  }

  function div(uint256 a, uint256 b) internal pure returns (uint256) {
    // assert(b > 0); // Solidity automatically throws when dividing by 0
    uint256 c = a / b;
    // assert(a == b * c + a % b); // There is no case in which this doesn't hold
    return c;
  }

  function sub(uint256 a, uint256 b) internal pure returns (uint256) {
    assert(b <= a);
    return a - b;
  }

  function add(uint256 a, uint256 b) internal pure returns (uint256) {
    uint256 c = a + b;
    assert(c >= a);
    return c;
  }
}

/**
 * @title Ownable
 * @dev The Ownable contract has an owner address, and provides basic authorization control
 * functions, this simplifies the implementation of "user permissions".
 */
contract Ownable {
  address public owner;

  event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

  /**
   * @dev The Ownable constructor sets the original `owner` of the contract to the sender
   * account.
   */
  constructor() public {
    owner = msg.sender;
  }

  /**
   * @dev Throws if called by any account other than the owner.
   */
  modifier onlyOwner() {
    require(msg.sender == owner);
    _;
  }


  /**
   * @dev Allows the current owner to transfer control of the contract to a newOwner.
   * @param newOwner The address to transfer ownership to.
   */
  function transferOwnership(address newOwner) public onlyOwner {
    require(newOwner != address(0));
    emit OwnershipTransferred(owner, newOwner);
    owner = newOwner;
  }

}

/**
 * @title Pausable
 * @dev Base contract which allows children to implement an emergency stop mechanism.
 */
contract Pausable is Ownable {
  event Pause();
  event Unpause();

  bool public paused = false;


  /**
   * @dev Modifier to make a function callable only when the contract is not paused.
   */
  modifier whenNotPaused() {
    require(!paused);
    _;
  }

  /**
   * @dev Modifier to make a function callable only when the contract is paused.
   */
  modifier whenPaused() {
    require(paused);
    _;
  }

  /**
   * @dev called by the owner to pause, triggers stopped state
   */
  function pause() onlyOwner whenNotPaused public {
    paused = true;
    emit Pause();
  }

  /**
   * @dev called by the owner to unpause, returns to normal state
   */
  function unpause() onlyOwner whenPaused public {
    paused = false;
    emit Unpause();
  }
}

/**
 * @title ERC20Basic
 * @dev see https://github.com/ethereum/EIPs/issues/179
 */
contract ERC20Basic {
  uint256 public totalSupply;
  function balanceOf(address who) public view returns (uint256);
  function transfer(address to, uint256 value) public returns (bool);
  event Transfer(address indexed from, address indexed to, uint256 value);
}

/**
 * @title ERC20 interface
 * @dev see https://github.com/ethereum/EIPs/issues/20
 */
contract ERC20 is ERC20Basic {
  function allowance(address owner, address spender) public view returns (uint256);
  function transferFrom(address from, address to, uint256 value) public returns (bool);
  function approve(address spender, uint256 value) public returns (bool);
  event Approval(address indexed owner, address indexed spender, uint256 value);
}


/**
 * @title ParadiseAlpha
 * @dev Contract for the Alpha version of the Paradise service. 
 * Allows for booking properties, withdrawal and refund of reservation
 */
contract ParadiseAlpha is Ownable, Pausable {
    using SafeMath for uint256;

    event LogReservation(bytes32 bookingId, address reserverAddress, uint costPDT, uint refundDeadline, uint refundAmountPDT, uint securityDepositPDT);
    event LogCancelation(bytes32 bookingId, address reserverAddress, uint refundedAmountPDT);
    event LogWithdrawal(bytes32 bookingId, uint withdrawAmountPDT, uint securityDeposit);

    struct Reservation {
        address reserverAddress;
        uint securityDepositPDT;
        uint costPDT;
        uint refundDeadline;
        uint refundAmountPDT;
        uint bookingArrayIndex;
        bool isActive;
    }

    constructor(address PDTTokenContractAddress) public {
        PDTTokenContract = ERC20(PDTTokenContractAddress);
    }

    ERC20 public PDTTokenContract;

    bytes32[] public bookingIds;
    mapping (bytes32 => Reservation) public bookings;
    
    /**
     * @dev modifier ensuring that the modified method is only called by the reserver in the booking
     * @param bookingId - the identifier of the reservation
     */
    modifier onlyReserver(bytes32 bookingId) {
        require(bookingId != 0);
        Reservation storage r = bookings[bookingId];
        require(r.reserverAddress == msg.sender);
        _;
    }

    /**
     * @dev modifier ensuring that the modified method is only called on active reservations
     * @param bookingId - the identifier of the reservation
     */
    modifier onlyActive(bytes32 bookingId) {
        require(bookingId != 0);
        Reservation storage r = bookings[bookingId];
        require(r.isActive);
        _;
    }

    /**
     * @dev modifier ensuring that the modified method is only executed before the refund deadline
     * @param bookingId - the identifier of the reservation
     */
    modifier onlyBeforeDeadline(bytes32 bookingId) {
        require(bookingId != 0);
        Reservation storage r = bookings[bookingId];
        require(now < r.refundDeadline);
        _;
    }

     /**
     * @dev modifier ensuring that the modified method is only executed after the refund deadline
     * @param bookingId - the identifier of the reservation
     */
    modifier onlyAfterDeadline(bytes32 bookingId) {
        require(bookingId != 0);
        Reservation storage r = bookings[bookingId];
        require(now > r.refundDeadline);
        _;
    }
    
    function reservationsCount() public constant returns(uint) {
        return bookingIds.length;
    }

    /**
     * @dev function to ensure complete unlinking of booking from the mapping and array
     * @notice it marks the unlinked element as inactive
     * @notice it swaps the last element with the unlinked one and marks it in the mapping
     * @param bookingId - the identifier of the reservation
     */
    function unlinkBooking(bytes32 bookingId) private {
        bytes32 lastId = bookingIds[bookingIds.length-1];
        bookingIds[bookings[bookingId].bookingArrayIndex] = lastId;
        bookingIds.length--;
        bookings[lastId].bookingArrayIndex = bookings[bookingId].bookingArrayIndex;
        bookings[bookingId].isActive = false;
    }
    
    /**
     * @dev called by the owner of the contract to make a reservation and withdraw PDT
     * @notice the reservator has to approve enough allowance before calling this
     * @param bookingId - the identifier of the reservation
     * @param reservationCostPDT - the cost of the reservation
     * @param refundDeadline - the last date the user can ask for refund
     * @param refundAmountPDT - how many tokens the refund is
     */
    function reserve
        (bytes32 bookingId, uint reservationCostPDT, uint refundDeadline, uint refundAmountPDT, uint securityDepositPDT) 
        public whenNotPaused returns(bool success) 
    {
        require(now < refundDeadline);
        require(!bookings[bookingId].isActive);

        bookings[bookingId] = Reservation({
            reserverAddress: msg.sender,
            costPDT: reservationCostPDT,
            refundDeadline: refundDeadline,
            refundAmountPDT: refundAmountPDT,
            securityDepositPDT: securityDepositPDT,
            bookingArrayIndex: bookingIds.length,
            isActive: true
        });

        bookingIds.push(bookingId);

        assert(PDTTokenContract.transferFrom(msg.sender, this, (reservationCostPDT + securityDepositPDT)));

        emit LogReservation(bookingId, msg.sender, reservationCostPDT, refundDeadline, refundAmountPDT, securityDepositPDT);

        return true;
    }
    
    /**
     * @dev called by the reserver to cancel his/her booking
     * @param bookingId - the identifier of the reservation
     */
    function cancelBooking(bytes32 bookingId) 
        whenNotPaused onlyReserver(bookingId) onlyActive(bookingId) onlyBeforeDeadline(bookingId) public returns(bool) 
    {
        uint PDTToBeRefunded = bookings[bookingId].refundAmountPDT + bookings[bookingId].securityDepositPDT;
        uint serviceFee = bookings[bookingId].costPDT.sub(bookings[bookingId].refundAmountPDT);

        unlinkBooking(bookingId);
        assert(PDTTokenContract.transfer(bookings[bookingId].reserverAddress, PDTToBeRefunded));
        if (serviceFee > 0) {
            assert(PDTTokenContract.transfer(owner, serviceFee));
        }
        emit LogCancelation(bookingId, bookings[bookingId].reserverAddress, PDTToBeRefunded);
        return true;
    }
    
    /**
     * @dev called by owner to make PDT withdrawal for this reservation
     * @param bookingId - the identifier of the reservation
     */
    function withdraw(bytes32 bookingId) 
        whenNotPaused onlyOwner onlyActive(bookingId) onlyAfterDeadline(bookingId) public returns(bool) 
    {
        uint PDTToBeWithdrawn = bookings[bookingId].costPDT;
        unlinkBooking(bookingId);
        assert(PDTTokenContract.transfer(owner, PDTToBeWithdrawn));
        assert(PDTTokenContract.transfer(bookings[bookingId].reserverAddress, bookings[bookingId].securityDepositPDT));
        emit LogWithdrawal(bookingId, PDTToBeWithdrawn, bookings[bookingId].securityDepositPDT);
        return true;
    }
    
}
