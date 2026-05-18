const { Buffer } = require('node:buffer');
const { loadProto, getRoot } = require('../utils/proto');
const cryptoWasm = require('../utils/crypto-wasm');

const RPC_TYPES = {
    'gamepb.userpb.UserService.Login': ['gamepb.userpb.LoginRequest', 'gamepb.userpb.LoginReply'],
    'gamepb.userpb.UserService.Heartbeat': ['gamepb.userpb.HeartbeatRequest', 'gamepb.userpb.HeartbeatReply'],
    'gamepb.userpb.UserService.ReportArkClick': ['gamepb.userpb.ReportArkClickRequest', 'gamepb.userpb.ReportArkClickReply'],

    'gamepb.plantpb.PlantService.AllLands': ['gamepb.plantpb.AllLandsRequest', 'gamepb.plantpb.AllLandsReply'],
    'gamepb.plantpb.PlantService.Harvest': ['gamepb.plantpb.HarvestRequest', 'gamepb.plantpb.HarvestReply'],
    'gamepb.plantpb.PlantService.WaterLand': ['gamepb.plantpb.WaterLandRequest', 'gamepb.plantpb.WaterLandReply'],
    'gamepb.plantpb.PlantService.WeedOut': ['gamepb.plantpb.WeedOutRequest', 'gamepb.plantpb.WeedOutReply'],
    'gamepb.plantpb.PlantService.Insecticide': ['gamepb.plantpb.InsecticideRequest', 'gamepb.plantpb.InsecticideReply'],
    'gamepb.plantpb.PlantService.RemovePlant': ['gamepb.plantpb.RemovePlantRequest', 'gamepb.plantpb.RemovePlantReply'],
    'gamepb.plantpb.PlantService.Fertilize': ['gamepb.plantpb.FertilizeRequest', 'gamepb.plantpb.FertilizeReply'],
    'gamepb.plantpb.PlantService.PutInsects': ['gamepb.plantpb.PutInsectsRequest', 'gamepb.plantpb.PutInsectsReply'],
    'gamepb.plantpb.PlantService.PutWeeds': ['gamepb.plantpb.PutWeedsRequest', 'gamepb.plantpb.PutWeedsReply'],
    'gamepb.plantpb.PlantService.UpgradeLand': ['gamepb.plantpb.UpgradeLandRequest', 'gamepb.plantpb.UpgradeLandReply'],
    'gamepb.plantpb.PlantService.UnlockLand': ['gamepb.plantpb.UnlockLandRequest', 'gamepb.plantpb.UnlockLandReply'],
    'gamepb.plantpb.PlantService.CheckCanOperate': ['gamepb.plantpb.CheckCanOperateRequest', 'gamepb.plantpb.CheckCanOperateReply'],
    'gamepb.plantpb.PlantService.Plant': ['gamepb.plantpb.PlantRequest', 'gamepb.plantpb.PlantReply'],

    'gamepb.itempb.ItemService.Bag': ['gamepb.itempb.BagRequest', 'gamepb.itempb.BagReply'],
    'gamepb.itempb.ItemService.Sell': ['gamepb.itempb.SellRequest', 'gamepb.itempb.SellReply'],
    'gamepb.itempb.ItemService.Use': ['gamepb.itempb.UseRequest', 'gamepb.itempb.UseReply'],
    'gamepb.itempb.ItemService.BatchUse': ['gamepb.itempb.BatchUseRequest', 'gamepb.itempb.BatchUseReply'],

    'gamepb.shoppb.ShopService.ShopProfiles': ['gamepb.shoppb.ShopProfilesRequest', 'gamepb.shoppb.ShopProfilesReply'],
    'gamepb.shoppb.ShopService.ShopInfo': ['gamepb.shoppb.ShopInfoRequest', 'gamepb.shoppb.ShopInfoReply'],
    'gamepb.shoppb.ShopService.BuyGoods': ['gamepb.shoppb.BuyGoodsRequest', 'gamepb.shoppb.BuyGoodsReply'],

    'gamepb.mallpb.MallService.GetMonthCardInfos': ['gamepb.mallpb.GetMonthCardInfosRequest', 'gamepb.mallpb.GetMonthCardInfosReply'],
    'gamepb.mallpb.MallService.ClaimMonthCardReward': ['gamepb.mallpb.ClaimMonthCardRewardRequest', 'gamepb.mallpb.ClaimMonthCardRewardReply'],
    'gamepb.mallpb.MallService.GetMallListBySlotType': ['gamepb.mallpb.GetMallListBySlotTypeRequest', 'gamepb.mallpb.GetMallListBySlotTypeResponse'],
    'gamepb.mallpb.MallService.Purchase': ['gamepb.mallpb.PurchaseRequest', 'gamepb.mallpb.PurchaseResponse'],

    'gamepb.redpacketpb.RedPacketService.GetTodayClaimStatus': ['gamepb.redpacketpb.GetTodayClaimStatusRequest', 'gamepb.redpacketpb.GetTodayClaimStatusReply'],
    'gamepb.redpacketpb.RedPacketService.ClaimRedPacket': ['gamepb.redpacketpb.ClaimRedPacketRequest', 'gamepb.redpacketpb.ClaimRedPacketReply'],

    'gamepb.qqvippb.QQVipService.GetDailyGiftStatus': ['gamepb.qqvippb.GetDailyGiftStatusRequest', 'gamepb.qqvippb.GetDailyGiftStatusReply'],
    'gamepb.qqvippb.QQVipService.ClaimDailyGift': ['gamepb.qqvippb.ClaimDailyGiftRequest', 'gamepb.qqvippb.ClaimDailyGiftReply'],

    'gamepb.sharepb.ShareService.CheckCanShare': ['gamepb.sharepb.CheckCanShareRequest', 'gamepb.sharepb.CheckCanShareReply'],
    'gamepb.sharepb.ShareService.ReportShare': ['gamepb.sharepb.ReportShareRequest', 'gamepb.sharepb.ReportShareReply'],
    'gamepb.sharepb.ShareService.ClaimShareReward': ['gamepb.sharepb.ClaimShareRewardRequest', 'gamepb.sharepb.ClaimShareRewardReply'],

    'gamepb.illustratedpb.IllustratedService.GetIllustratedListV2': ['gamepb.illustratedpb.GetIllustratedListV2Request', 'gamepb.illustratedpb.GetIllustratedListV2Reply'],
    'gamepb.illustratedpb.IllustratedService.ClaimAllRewardsV2': ['gamepb.illustratedpb.ClaimAllRewardsV2Request', 'gamepb.illustratedpb.ClaimAllRewardsV2Reply'],

    'gamepb.friendpb.FriendService.GetAll': ['gamepb.friendpb.GetAllRequest', 'gamepb.friendpb.GetAllReply'],
    'gamepb.friendpb.FriendService.SyncAll': ['gamepb.friendpb.SyncAllRequest', 'gamepb.friendpb.SyncAllReply'],
    'gamepb.friendpb.FriendService.GetGameFriends': ['gamepb.friendpb.GetGameFriendsRequest', 'gamepb.friendpb.GetGameFriendsReply'],
    'gamepb.friendpb.FriendService.GetApplications': ['gamepb.friendpb.GetApplicationsRequest', 'gamepb.friendpb.GetApplicationsReply'],
    'gamepb.friendpb.FriendService.AcceptFriends': ['gamepb.friendpb.AcceptFriendsRequest', 'gamepb.friendpb.AcceptFriendsReply'],
    'gamepb.friendpb.FriendService.RejectFriends': ['gamepb.friendpb.RejectFriendsRequest', 'gamepb.friendpb.RejectFriendsReply'],
    'gamepb.friendpb.FriendService.SetBlockApplications': ['gamepb.friendpb.SetBlockApplicationsRequest', 'gamepb.friendpb.SetBlockApplicationsReply'],
    'gamepb.friendpb.FriendService.DelFriend': ['gamepb.friendpb.DelFriendRequest', 'gamepb.friendpb.DelFriendReply'],
    'gamepb.friendpb.FriendService.BlockFriend': ['gamepb.friendpb.BlockFriendRequest', 'gamepb.friendpb.BlockFriendReply'],
    'gamepb.friendpb.FriendService.UnblockFriend': ['gamepb.friendpb.UnblockFriendRequest', 'gamepb.friendpb.UnblockFriendReply'],
    'gamepb.friendpb.FriendService.GetBlockList': ['gamepb.friendpb.GetBlockListRequest', 'gamepb.friendpb.GetBlockListReply'],
    'gamepb.friendpb.FriendService.SetTags': ['gamepb.friendpb.SetTagsRequest', 'gamepb.friendpb.SetTagsReply'],

    'gamepb.interactpb.InteractService.InteractRecords': ['gamepb.interactpb.InteractRecordsRequest', 'gamepb.interactpb.InteractRecordsReply'],
    'gamepb.interactpb.InteractService.GetInteractRecords': ['gamepb.interactpb.InteractRecordsRequest', 'gamepb.interactpb.InteractRecordsReply'],
    'gamepb.interactpb.VisitorService.InteractRecords': ['gamepb.interactpb.InteractRecordsRequest', 'gamepb.interactpb.InteractRecordsReply'],
    'gamepb.interactpb.VisitorService.GetInteractRecords': ['gamepb.interactpb.InteractRecordsRequest', 'gamepb.interactpb.InteractRecordsReply'],

    'gamepb.visitpb.VisitService.Enter': ['gamepb.visitpb.EnterRequest', 'gamepb.visitpb.EnterReply'],
    'gamepb.visitpb.VisitService.Leave': ['gamepb.visitpb.LeaveRequest', 'gamepb.visitpb.LeaveReply'],

    'gamepb.taskpb.TaskService.TaskInfo': ['gamepb.taskpb.TaskInfoRequest', 'gamepb.taskpb.TaskInfoReply'],
    'gamepb.taskpb.TaskService.ClaimTaskReward': ['gamepb.taskpb.ClaimTaskRewardRequest', 'gamepb.taskpb.ClaimTaskRewardReply'],
    'gamepb.taskpb.TaskService.BatchClaimTaskReward': ['gamepb.taskpb.BatchClaimTaskRewardRequest', 'gamepb.taskpb.BatchClaimTaskRewardReply'],
    'gamepb.taskpb.TaskService.ClaimDailyReward': ['gamepb.taskpb.ClaimDailyRewardRequest', 'gamepb.taskpb.ClaimDailyRewardReply'],
    'gamepb.taskpb.TaskService.ClientReportProgress': ['gamepb.taskpb.ClientReportProgressRequest', 'gamepb.taskpb.ClientReportProgressReply'],

    'gamepb.emailpb.EmailService.GetEmailList': ['gamepb.emailpb.GetEmailListRequest', 'gamepb.emailpb.GetEmailListReply'],
    'gamepb.emailpb.EmailService.ReadEmail': ['gamepb.emailpb.ReadEmailRequest', 'gamepb.emailpb.ReadEmailReply'],
    'gamepb.emailpb.EmailService.ClaimEmail': ['gamepb.emailpb.ClaimEmailRequest', 'gamepb.emailpb.ClaimEmailReply'],
    'gamepb.emailpb.EmailService.BatchClaimEmail': ['gamepb.emailpb.BatchClaimEmailRequest', 'gamepb.emailpb.BatchClaimEmailReply'],
    'gamepb.emailpb.EmailService.BatchDeleteEmail': ['gamepb.emailpb.BatchDeleteEmailRequest', 'gamepb.emailpb.BatchDeleteEmailReply'],
    'gamepb.emailpb.EmailService.BatchReadEmail': ['gamepb.emailpb.BatchReadEmailRequest', 'gamepb.emailpb.BatchReadEmailReply'],

    'gamepb.userpb.UserService.Logout': ['gamepb.userpb.LogoutRequest', 'gamepb.userpb.LogoutReply'],
    'gamepb.userpb.UserService.SetQQFriendRecommendAuthorized': ['gamepb.userpb.SetQQFriendRecommendAuthorizedRequest', 'gamepb.userpb.SetQQFriendRecommendAuthorizedReply'],
    'gamepb.userpb.UserService.SetUserSettings': ['gamepb.userpb.SetUserSettingsRequest', 'gamepb.userpb.SetUserSettingsReply'],
    'gamepb.userpb.UserService.GetUserSettings': ['gamepb.userpb.GetUserSettingsRequest', 'gamepb.userpb.GetUserSettingsReply'],
    'gamepb.userpb.UserService.BatchGetBasicInfo': ['gamepb.userpb.BatchGetBasicInfoRequest', 'gamepb.userpb.BatchGetBasicInfoReply'],
    'gamepb.userpb.UserService.GetBriefInfo': ['gamepb.userpb.GetBriefInfoRequest', 'gamepb.userpb.GetBriefInfoReply'],
    'gamepb.userpb.UserService.DeleteAccount': ['gamepb.userpb.DeleteAccountRequest', 'gamepb.userpb.DeleteAccountReply'],

    'gamepb.plantpb.PlantService.GetPlayerData': ['gamepb.plantpb.GetPlayerDataRequest', 'gamepb.plantpb.GetPlayerDataReply'],

    'gamepb.mallpb.MallService.GetMallProfiles': ['gamepb.mallpb.GetMallProfilesRequest', 'gamepb.mallpb.GetMallProfilesReply'],

    'gamepb.qqvippb.QQVipService.RefreshVipInfo': ['gamepb.qqvippb.RefreshVipInfoRequest', 'gamepb.qqvippb.RefreshVipInfoReply'],

    'gamepb.interactpb.InteractService.GetInteractInfo': ['gamepb.interactpb.GetInteractInfoRequest', 'gamepb.interactpb.GetInteractInfoReply'],
    'gamepb.interactpb.InteractService.GetInteractSummary': ['gamepb.interactpb.GetInteractSummaryRequest', 'gamepb.interactpb.GetInteractSummaryReply'],
    'gamepb.interactpb.InteractService.DismissInteractPopup': ['gamepb.interactpb.DismissInteractPopupRequest', 'gamepb.interactpb.DismissInteractPopupReply'],
    'gamepb.interactpb.InteractService.DeleteInteractions': ['gamepb.interactpb.DeleteInteractionsRequest', 'gamepb.interactpb.DeleteInteractionsResponse'],

    'gamepb.skinpb.SkinService.SkinsOwned': ['gamepb.skinpb.SkinsOwnedRequest', 'gamepb.skinpb.SkinsOwnedReply'],
    'gamepb.skinpb.SkinService.SkinsEquipped': ['gamepb.skinpb.SkinsEquippedRequest', 'gamepb.skinpb.SkinsEquippedReply'],
    'gamepb.skinpb.SkinService.Equip': ['gamepb.skinpb.EquipRequest', 'gamepb.skinpb.EquipReply'],
    'gamepb.skinpb.SkinService.Unequip': ['gamepb.skinpb.UnequipRequest', 'gamepb.skinpb.UnequipReply'],

    'gamepb.dogpb.DogService.GetDogInfo': ['gamepb.dogpb.GetDogInfoRequest', 'gamepb.dogpb.GetDogInfoReply'],
    'gamepb.dogpb.DogService.ActivateDog': ['gamepb.dogpb.ActivateDogRequest', 'gamepb.dogpb.ActivateDogReply'],
    'gamepb.dogpb.DogService.BuyAndActivateDog': ['gamepb.dogpb.BuyAndActivateDogRequest', 'gamepb.dogpb.BuyAndActivateDogReply'],
    'gamepb.dogpb.DogService.DeployDog': ['gamepb.dogpb.DeployDogRequest', 'gamepb.dogpb.DeployDogReply'],
    'gamepb.dogpb.DogService.WithdrawDog': ['gamepb.dogpb.WithdrawDogRequest', 'gamepb.dogpb.WithdrawDogReply'],
    'gamepb.dogpb.DogService.AddFood': ['gamepb.dogpb.AddFoodRequest', 'gamepb.dogpb.AddFoodReply'],
    'gamepb.dogpb.DogService.GetProtectLogs': ['gamepb.dogpb.GetProtectLogsRequest', 'gamepb.dogpb.GetProtectLogsReply'],
    'gamepb.dogpb.DogService.ClaimSkillGifts': ['gamepb.dogpb.ClaimSkillGiftsRequest', 'gamepb.dogpb.ClaimSkillGiftsReply'],

    'gamepb.careerpb.CareerService.CareerInfoGet': ['gamepb.careerpb.CareerInfoGetRequest', 'gamepb.careerpb.CareerInfoGetReply'],

    'gamepb.avatarframepb.AvatarFrameService.AvatarFramesOwned': ['gamepb.avatarframepb.AvatarFramesOwnedRequest', 'gamepb.avatarframepb.AvatarFramesOwnedReply'],
    'gamepb.avatarframepb.AvatarFrameService.AvatarFramesEquiped': ['gamepb.avatarframepb.AvatarFramesEquipedRequest', 'gamepb.avatarframepb.AvatarFramesEquipedReply'],
    'gamepb.avatarframepb.AvatarFrameService.UpdateEquip': ['gamepb.avatarframepb.UpdateEquipRequest', 'gamepb.avatarframepb.UpdateEquipReply'],

    'gamepb.rankpb.RankService.GetGroup': ['gamepb.rankpb.GetGroupRequest', 'gamepb.rankpb.GetGroupReply'],
    'gamepb.rankpb.RankService.List': ['gamepb.rankpb.ListRequest', 'gamepb.rankpb.ListReply'],

    'gamepb.activitypb.ActivityService.GetActivityInfo': ['gamepb.activitypb.GetActivityInfoRequest', 'gamepb.activitypb.GetActivityInfoReply'],

    'gamepb.randomdroppb.RandomDropService.GetInfo': ['gamepb.randomdroppb.GetInfoRequest', 'gamepb.randomdroppb.GetInfoReply'],

    'gamepb.mutantpb.MutantService.ReadMutantBook': ['gamepb.mutantpb.ReadMutantBookRequest', 'gamepb.mutantpb.ReadMutantBookReply'],

    'gamepb.guidepb.GuideService.SetCurrNode': ['gamepb.guidepb.SetCurrNodeRequest', 'gamepb.guidepb.SetCurrNodeReply'],
    'gamepb.guidepb.GuideService.ClaimWeakGuideReward': ['gamepb.guidepb.ClaimWeakGuideRewardRequest', 'gamepb.guidepb.ClaimWeakGuideRewardReply'],
    'gamepb.guidepb.GuideService.SetWeakGuideNodeComplete': ['gamepb.guidepb.SetWeakGuideNodeCompleteRequest', 'gamepb.guidepb.SetWeakGuideNodeCompleteReply'],

    'gamepb.bulletinboardpb.BulletinBoardService.GetBulletinList': ['gamepb.bulletinboardpb.GetBulletinListRequest', 'gamepb.bulletinboardpb.GetBulletinListReply'],
    'gamepb.bulletinboardpb.BulletinBoardService.GetBulletinDetail': ['gamepb.bulletinboardpb.GetBulletinDetailRequest', 'gamepb.bulletinboardpb.GetBulletinDetailReply'],

    'gamepb.weatherpb.WeatherService.GetCurrentWeather': ['gamepb.weatherpb.GetCurrentWeatherRequest', 'gamepb.weatherpb.GetCurrentWeatherReply'],
    'gamepb.weatherpb.WeatherService.GetTodayWeather': ['gamepb.weatherpb.GetTodayWeatherRequest', 'gamepb.weatherpb.GetTodayWeatherReply'],

    'gamepb.marqueepb.MarqueeService.GetMarquee': ['gamepb.marqueepb.GetMarqueeRequest', 'gamepb.marqueepb.GetMarqueeReply'],

    'gamepb.nudgepb.NudgeService.HandleNudgeResponse': ['gamepb.nudgepb.HandleNudgeResponseRequest', 'gamepb.nudgepb.HandleNudgeResponseReply'],

    'gamepb.paypb.PayService.GetRechargeInfo': ['gamepb.paypb.GetRechargeInfoRequest', 'gamepb.paypb.GetRechargeInfoReply'],
    'gamepb.paypb.PayService.PayDiamond': ['gamepb.paypb.PayDiamondRequest', 'gamepb.paypb.PayDiamondReply'],
    'gamepb.paypb.PayService.PayDirectBuy': ['gamepb.paypb.PayDirectBuyRequest', 'gamepb.paypb.PayDirectBuyReply'],
    'gamepb.paypb.PayService.PayDoneReport': ['gamepb.paypb.PayDoneReportRequest', 'gamepb.paypb.PayDoneReportReply'],
    'gamepb.paypb.PayService.GetDiamondItems': ['gamepb.paypb.GetDiamondItemsRequest', 'gamepb.paypb.GetDiamondItemsReply'],

    'gamepb.acepb.AceService.AntiData': ['gamepb.acepb.AntiDataRequest', 'gamepb.acepb.AntiDataReply'],

    'gamepb.rechargebonuspb.RechargeBonusService.GetConfig': ['gamepb.rechargebonuspb.GetConfigRequest', 'gamepb.rechargebonuspb.GetConfigReply'],

    'gamepb.guestbookpb.GuestBookService.GetMessageList': ['gamepb.guestbookpb.GetMessageListRequest', 'gamepb.guestbookpb.GetMessageListResponse'],
    'gamepb.guestbookpb.GuestBookService.PostMessage': ['gamepb.guestbookpb.PostMessageRequest', 'gamepb.guestbookpb.PostMessageResponse'],
    'gamepb.guestbookpb.GuestBookService.DeleteMessage': ['gamepb.guestbookpb.DeleteMessageRequest', 'gamepb.guestbookpb.DeleteMessageResponse'],
    'gamepb.guestbookpb.GuestBookService.GetReplies': ['gamepb.guestbookpb.GetRepliesRequest', 'gamepb.guestbookpb.GetRepliesResponse'],
    'gamepb.guestbookpb.GuestBookService.PostReply': ['gamepb.guestbookpb.PostReplyRequest', 'gamepb.guestbookpb.PostReplyResponse'],
    'gamepb.guestbookpb.GuestBookService.DeleteReply': ['gamepb.guestbookpb.DeleteReplyRequest', 'gamepb.guestbookpb.DeleteReplyResponse'],
    'gamepb.guestbookpb.GuestBookService.LikeMessage': ['gamepb.guestbookpb.LikeMessageRequest', 'gamepb.guestbookpb.LikeMessageResponse'],
    'gamepb.guestbookpb.GuestBookService.LikeReply': ['gamepb.guestbookpb.LikeReplyRequest', 'gamepb.guestbookpb.LikeReplyResponse'],
    'gamepb.guestbookpb.GuestBookService.PinMessage': ['gamepb.guestbookpb.PinMessageRequest', 'gamepb.guestbookpb.PinMessageResponse'],
    'gamepb.guestbookpb.GuestBookService.GetUnreadCount': ['gamepb.guestbookpb.GetUnreadCountRequest', 'gamepb.guestbookpb.GetUnreadCountResponse'],

    'gamepb.subscribewxmsg.OpenPlatformSettingService.GetSubscribeMessageStatus': ['gamepb.subscribewxmsg.GetSubscribeMessageStatusRequest', 'gamepb.subscribewxmsg.GetSubscribeMessageStatusReply'],
    'gamepb.subscribewxmsg.OpenPlatformSettingService.SetSubscribeMessageStatus': ['gamepb.subscribewxmsg.SetSubscribeMessageStatusRequest', 'gamepb.subscribewxmsg.SetSubscribeMessageStatusReply'],

    'gamepb.uicproxypb.UicprotoxyService.ModeratePic': ['gamepb.uicproxypb.ModeratePicRequest', 'gamepb.uicproxypb.ModeratePicReply'],
    'gamepb.uicproxypb.UicprotoxyService.ModerateText': ['gamepb.uicproxypb.ModerateTextRequest', 'gamepb.uicproxypb.ModerateTextReply'],
    'gamepb.uicproxypb.UicprotoxyService.BatchModeratePic': ['gamepb.uicproxypb.BatchModeratePicRequest', 'gamepb.uicproxypb.BatchModeratePicReply'],
    'gamepb.uicproxypb.UicprotoxyService.BatchModerateText': ['gamepb.uicproxypb.BatchModerateTextRequest', 'gamepb.uicproxypb.BatchModerateTextReply'],

    'gamepb.systemopenpb.SystemOpenService.GetSystemOpenInfo': ['gamepb.systemopenpb.GetSystemOpenInfoRequest', 'gamepb.systemopenpb.GetSystemOpenInfoReply'],
};

const NOTIFY_TYPES = {
    Kickout: 'gatepb.KickoutNotify',
    LandsNotify: 'gamepb.plantpb.LandsNotify',
    ItemNotify: 'gamepb.itempb.ItemNotify',
    BasicNotify: 'gamepb.userpb.BasicNotify',
    FriendApplicationReceivedNotify: 'gamepb.friendpb.FriendApplicationReceivedNotify',
    FriendAddedNotify: 'gamepb.friendpb.FriendAddedNotify',
    DelFriendNotify: 'gamepb.friendpb.DelFriendNotify',
    BlockedByFriendNotify: 'gamepb.friendpb.BlockedByFriendNotify',
    GoodsUnlockNotify: 'gamepb.shoppb.GoodsUnlockNotify',
    TaskInfoNotify: 'gamepb.taskpb.TaskInfoNotify',
    IllustratedRewardRedDotNotifyV2: 'gamepb.illustratedpb.IllustratedRewardRedDotNotifyV2',
    IllustratedChangeNotifyV2: 'gamepb.illustratedpb.IllustratedChangeNotifyV2',
    DogProtectionNotify: 'gamepb.illustratedpb.DogProtectionNotify',
    StealBonusNotify: 'gamepb.illustratedpb.StealBonusNotify',
    HarvestBonusNotify: 'gamepb.illustratedpb.HarvestBonusNotify',
    NewEmailNotify: 'gamepb.emailpb.NewEmailNotify',
    NeedNotify: 'gamepb.mallpb.NeedNotify',
    ProductsHasChangedNotify: 'gamepb.mallpb.ProductsHasChangedNotify',
    MonthCardInfoNTF: 'gamepb.mallpb.MonthCardInfoNTF',
    HostAtHomeNotify: 'gamepb.visitpb.HostAtHomeNotify',
    InteractNewRecordNotify: 'gamepb.interactpb.InteractNewRecordNotify',
    DailyGiftStatusChangedNTF: 'gamepb.qqvippb.DailyGiftStatusChangedNTF',
    VipInfoUpdatedNTF: 'gamepb.qqvippb.VipInfoUpdatedNTF',
    GetTodayClaimStatusNotify: 'gamepb.redpacketpb.GetTodayClaimStatusNotify',
    SkinChangeNotify: 'gamepb.skinpb.SkinChangeNotify',
    SkinInvalidNotify: 'gamepb.skinpb.SkinInvalidNotify',
    SkinNewNotify: 'gamepb.skinpb.SkinNewNotify',
    SkillTriggerNotify: 'gamepb.dogpb.SkillTriggerNotify',
    DogStatusNotify: 'gamepb.dogpb.DogStatusNotify',
    NewProtectLogNotify: 'gamepb.dogpb.NewProtectLogNotify',
    TipsNotify: 'gamepb.tipspb.TipsNotify',
    ActivityStatusChangeNotify: 'gamepb.randomdroppb.ActivityStatusChangeNotify',
    ActiviesChangeNotify: 'gamepb.activitypb.ActiviesChangeNotify',
    AvatarFrameRedDotNotify: 'gamepb.avatarframepb.AvatarFrameRedDotNotify',
    BulletinListChangedNTF: 'gamepb.bulletinboardpb.BulletinListChangedNTF',
    RechargeInfoNotify: 'gamepb.paypb.RechargeInfoNotify',
    SubscribeAuthPromptNotify: 'gamepb.subscribewxmsg.SubscribeAuthPromptNotify',
    SystemUnlockNotify: 'gamepb.systemopenpb.SystemUnlockNotify',
    MarqueeNotify: 'gamepb.marqueepb.MarqueeNotify',
};

const INFERENCE_EXCLUDED_TYPES = new Set([
    'gatepb.Message',
    'gatepb.Meta',
    'gatepb.EventMessage',
]);

function cleanHex(input) {
    return String(input || '')
        .replace(/\\x/gi, '')
        .replace(/0x/gi, '')
        .replace(/[^0-9a-f]/gi, '');
}

function bufferFromInput(input, format = 'auto') {
    const raw = String(input || '').trim();
    if (!raw) throw new Error('请输入协议数据');

    const normalizedFormat = String(format || 'auto').toLowerCase();
    if (normalizedFormat === 'hex') {
        const hex = cleanHex(raw);
        if (!hex || hex.length % 2 !== 0) throw new Error('Hex 长度不合法');
        return { buffer: Buffer.from(hex, 'hex'), format: 'hex' };
    }

    if (normalizedFormat === 'base64') {
        const base64 = raw.replace(/^data:[^,]+,/i, '').replace(/\s+/g, '');
        const buffer = Buffer.from(base64, 'base64');
        if (!buffer.length) throw new Error('Base64 内容为空');
        return { buffer, format: 'base64' };
    }

    const hexLike = /^[\s0-9a-fA-FxX\\:,\-_]+$/.test(raw);
    const hex = cleanHex(raw);
    if (hexLike && hex.length >= 2 && hex.length % 2 === 0) {
        return { buffer: Buffer.from(hex, 'hex'), format: 'hex' };
    }

    const base64 = raw.replace(/^data:[^,]+,/i, '').replace(/\s+/g, '');
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) throw new Error('无法识别输入格式');
    return { buffer, format: 'base64' };
}

function lookupType(root, typeName) {
    if (!typeName) return null;
    try {
        return root.lookupType(typeName);
    } catch {
        return null;
    }
}

function toPlain(type, message) {
    return type.toObject(message, {
        longs: String,
        enums: String,
        bytes: String,
        defaults: false,
        arrays: true,
        objects: true,
    });
}

function compactValue(value) {
    if (Array.isArray(value)) {
        const items = value.map(compactValue).filter(item => !isEmptyValue(item));
        return items;
    }
    if (value && typeof value === 'object') {
        const result = {};
        for (const [key, child] of Object.entries(value)) {
            const compacted = compactValue(child);
            if (!isEmptyValue(compacted)) result[key] = compacted;
        }
        return result;
    }
    return value;
}

function isEmptyValue(value) {
    if (value === undefined || value === null) return true;
    if (value === '') return true;
    if (Array.isArray(value)) return value.length === 0;
    if (value && typeof value === 'object') return Object.keys(value).length === 0;
    return false;
}

function scorePrimitive(value) {
    if (typeof value === 'boolean') return 1.5;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return -8;
        return value === 0 ? 0.2 : 2.5;
    }
    if (typeof value === 'string') {
        if (!value) return 0;
        if (/^-?\d+$/.test(value)) return value === '0' ? 0.2 : 2.5;
        const printable = /^[\u0020-\u007e\u4e00-\u9fa5，。！？：；、（）【】《》“”‘’]+$/.test(value);
        return Math.min(8, 2 + value.length / 12) + (printable ? 2 : -1);
    }
    return 0;
}

function scoreValue(value, depth = 0) {
    if (Array.isArray(value)) {
        if (value.length === 0) return 0;
        const itemScore = value.slice(0, 20).reduce((sum, item) => sum + scoreValue(item, depth + 1), 0);
        return 3 + Math.min(10, value.length) + itemScore;
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value);
        if (entries.length === 0) return 0;
        const fieldScore = entries.length * (depth === 0 ? 3 : 1.5);
        const childScore = entries.reduce((sum, [, child]) => sum + scoreValue(child, depth + 1), 0);
        return fieldScore + childScore;
    }
    return scorePrimitive(value);
}

function countPresentFields(value) {
    if (Array.isArray(value)) {
        return value.reduce((sum, item) => sum + countPresentFields(item), 0);
    }
    if (value && typeof value === 'object') {
        return Object.values(value).reduce((sum, child) => sum + 1 + countPresentFields(child), 0);
    }
    return isEmptyValue(value) ? 0 : 1;
}

function normalizeNamePart(value) {
    return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function getTypeNameHintScore(typeName, context = {}) {
    const parts = String(typeName || '').split('.');
    const baseName = parts[parts.length - 1] || '';
    const base = normalizeNamePart(baseName);
    const method = normalizeNamePart(context.methodName);
    const messageType = Number(context.messageType) || 0;
    let score = 0;

    if (method) {
        const expected = messageType === 1
            ? [`${method}request`]
            : messageType === 2
                ? [`${method}reply`, `${method}response`]
                : [];
        if (expected.includes(base)) score += 28;
        else if (base.includes(method)) score += 8;
    }

    const eventType = normalizeNamePart(context.eventType);
    if (eventType) {
        if (base === eventType) score += 28;
        else if (base.includes(eventType) || eventType.includes(base)) score += 10;
    }

    return score;
}

function decodeType(root, typeName, buffer) {
    const type = lookupType(root, typeName);
    if (!type) throw new Error(`未知 protobuf 类型: ${typeName}`);
    const decoded = type.decode(buffer || Buffer.alloc(0));
    return {
        type: typeName,
        value: toPlain(type, decoded),
    };
}

function byteSummary(buffer) {
    const buf = Buffer.from(buffer || Buffer.alloc(0));
    return {
        length: buf.length,
        hexPreview: buf.subarray(0, 96).toString('hex'),
        base64: buf.toString('base64'),
    };
}

function getRpcBodyType(meta) {
    const serviceName = String(meta.service_name || '').trim();
    const methodName = String(meta.method_name || '').trim();
    const pair = RPC_TYPES[`${serviceName}.${methodName}`];
    if (!pair) return '';
    const messageType = Number(meta.message_type) || 0;
    if (messageType === 1) return pair[0];
    if (messageType === 2) return pair[1];
    return '';
}

function getNotifyBodyType(messageType) {
    const text = String(messageType || '');
    for (const [key, typeName] of Object.entries(NOTIFY_TYPES)) {
        if (text.includes(key)) return typeName;
    }
    return '';
}

async function transformBody(buffer, mode, preferDecrypt = false) {
    const raw = Buffer.from(buffer || Buffer.alloc(0));
    const normalized = String(mode || 'auto').toLowerCase();
    if (normalized === 'none') return [{ name: 'raw', buffer: raw }];
    if (normalized === 'decrypt') {
        return [{ name: 'decrypt', buffer: await cryptoWasm.decryptBuffer(raw) }];
    }
    if (!raw.length) return [{ name: 'raw', buffer: raw }];

    const attempts = preferDecrypt ? ['decrypt', 'raw'] : ['raw', 'decrypt'];
    const result = [];
    for (const name of attempts) {
        if (name === 'raw') result.push({ name, buffer: raw });
        else {
            try {
                result.push({ name, buffer: await cryptoWasm.decryptBuffer(raw) });
            } catch (error) {
                result.push({ name, error: error.message });
            }
        }
    }
    return result;
}

async function decodeBodyWithAttempts(root, typeName, bodyBuffer, transformMode, preferDecrypt) {
    if (!typeName) return null;
    const attempts = await transformBody(bodyBuffer, transformMode, preferDecrypt);
    const errors = [];
    for (const attempt of attempts) {
        if (attempt.error) {
            errors.push(`${attempt.name}: ${attempt.error}`);
            continue;
        }
        try {
            const decoded = decodeType(root, typeName, attempt.buffer);
            return {
                ...decoded,
                transform: attempt.name,
                bytes: byteSummary(attempt.buffer),
            };
        } catch (error) {
            errors.push(`${attempt.name}: ${error.message}`);
        }
    }
    return {
        type: typeName,
        error: errors.join(' | ') || '解码失败',
    };
}

function collectProtocolTypes(root) {
    const result = [];
    walkTypes(root, '', result);
    return result.filter(name => name !== 'google.protobuf.Empty').sort();
}

async function inferBodyTypes(root, bodyBuffer, transformMode, preferDecrypt, options = {}) {
    const max = Math.max(1, Math.min(30, Number(options.max) || 12));
    const attempts = await transformBody(bodyBuffer, transformMode, preferDecrypt);
    const typeNames = collectProtocolTypes(root).filter(typeName => !INFERENCE_EXCLUDED_TYPES.has(typeName));
    const candidates = [];

    for (const attempt of attempts) {
        if (attempt.error || !attempt.buffer) continue;
        for (const typeName of typeNames) {
            const type = lookupType(root, typeName);
            if (!type) continue;
            try {
                const message = type.decode(attempt.buffer);
                const value = toPlain(type, message);
                const compacted = compactValue(value);
                const presentFields = countPresentFields(compacted);
                if (presentFields <= 0) continue;

                const typeHintScore = getTypeNameHintScore(typeName, options);
                const score = scoreValue(compacted) + Math.min(10, presentFields) + typeHintScore;
                if (score < 5) continue;

                candidates.push({
                    type: typeName,
                    transform: attempt.name,
                    score: Math.round(score * 10) / 10,
                    typeHintScore,
                    presentFields,
                    value: compacted,
                    bytes: byteSummary(attempt.buffer),
                });
            } catch {
                // Most wrong candidates fail by wire type; ignore them.
            }
        }
    }

    candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.presentFields !== a.presentFields) return b.presentFields - a.presentFields;
        return a.type.localeCompare(b.type);
    });

    const unique = [];
    const seen = new Set();
    for (const candidate of candidates) {
        const key = `${candidate.type}:${candidate.transform}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(candidate);
        if (unique.length >= max) break;
    }
    return unique;
}

function chooseInferredBody(candidates) {
    const list = Array.isArray(candidates) ? candidates : [];
    if (list.length === 0) return null;
    const [top, second] = list;
    if (top.score >= 10 && (!second || top.score - second.score >= 5)) return { ...top, inferred: true };
    return null;
}

async function decodeGatePacket(root, buffer, options = {}) {
    const gate = decodeType(root, 'gatepb.Message', buffer);
    const gateType = lookupType(root, 'gatepb.Message');
    const gateMessage = gateType.decode(buffer);
    const meta = gate.value.meta || {};
    const messageType = Number(meta.message_type) || 0;
    const bodyBuffer = Buffer.from(gateMessage.body || Buffer.alloc(0));
    const transformMode = options.bodyTransform || 'auto';

    const result = {
        mode: 'gate',
        input: byteSummary(buffer),
        gate: {
            meta,
            body: byteSummary(bodyBuffer),
        },
    };

    if (!bodyBuffer.length) return result;

    if (messageType === 3) {
        const eventDecode = await decodeBodyWithAttempts(root, 'gatepb.EventMessage', bodyBuffer, transformMode, false);
        result.event = eventDecode;

        const eventValue = eventDecode && eventDecode.value ? eventDecode.value : null;
        if (eventValue) {
            const eventType = String(eventValue.message_type || '');
            const notifyType = options.bodyType || getNotifyBodyType(eventType);
            const eventTypeObj = lookupType(root, 'gatepb.EventMessage');
            const eventMsg = eventTypeObj.decode(eventDecode.transform === 'decrypt'
                ? (await cryptoWasm.decryptBuffer(bodyBuffer))
                : bodyBuffer);
            const eventBodyBuffer = Buffer.from(eventMsg.body || Buffer.alloc(0));
            result.event.body = byteSummary(eventBodyBuffer);
            if (notifyType) {
                result.decodedBody = await decodeBodyWithAttempts(root, notifyType, eventBodyBuffer, 'none', false);
                if (result.decodedBody && result.decodedBody.error) {
                    result.bodyCandidates = await inferBodyTypes(root, eventBodyBuffer, 'none', false, { eventType });
                    const inferred = chooseInferredBody(result.bodyCandidates);
                    if (inferred) result.inferredBody = inferred;
                }
            } else {
                result.bodyTypeHint = '未识别 Notify 类型，已自动猜测候选 body 类型';
                result.bodyCandidates = await inferBodyTypes(root, eventBodyBuffer, 'none', false, { eventType });
                const inferred = chooseInferredBody(result.bodyCandidates);
                if (inferred) result.inferredBody = inferred;
            }
        }
        return result;
    }

    const typeName = options.bodyType || getRpcBodyType(meta);
    if (typeName) {
        result.decodedBody = await decodeBodyWithAttempts(root, typeName, bodyBuffer, transformMode, messageType === 1);
        if (result.decodedBody && result.decodedBody.error) {
            result.bodyCandidates = await inferBodyTypes(root, bodyBuffer, transformMode, messageType === 1, {
                methodName: meta.method_name,
                messageType,
            });
            const inferred = chooseInferredBody(result.bodyCandidates);
            if (inferred) result.inferredBody = inferred;
        }
    } else {
        result.bodyTypeHint = '未识别 RPC 类型，已自动猜测候选 body 类型';
        result.bodyCandidates = await inferBodyTypes(root, bodyBuffer, transformMode, messageType === 1, {
            methodName: meta.method_name,
            messageType,
        });
        const inferred = chooseInferredBody(result.bodyCandidates);
        if (inferred) result.inferredBody = inferred;
    }
    return result;
}

async function decodeProtocolPacket(options = {}) {
    await loadProto();
    const root = getRoot();
    const { buffer, format } = bufferFromInput(options.input, options.format || 'auto');
    const mode = String(options.mode || 'gate').toLowerCase();
    const bodyTransform = options.bodyTransform || 'auto';
    const bodyType = String(options.bodyType || '').trim();

    if (mode === 'body') {
        if (!bodyType) {
            const bodyCandidates = await inferBodyTypes(root, buffer, bodyTransform, bodyTransform !== 'none');
            const inferredBody = chooseInferredBody(bodyCandidates);
            return {
                mode: 'body',
                input: { ...byteSummary(buffer), format },
                bodyTypeHint: '未指定 body 类型，已自动猜测候选类型',
                bodyCandidates,
                inferredBody,
            };
        }
        const decodedBody = await decodeBodyWithAttempts(root, bodyType, buffer, bodyTransform, bodyTransform !== 'none');
        const result = {
            mode: 'body',
            input: { ...byteSummary(buffer), format },
            decodedBody,
        };
        if (decodedBody && decodedBody.error) {
            result.bodyCandidates = await inferBodyTypes(root, buffer, bodyTransform, bodyTransform !== 'none');
            result.inferredBody = chooseInferredBody(result.bodyCandidates);
        }
        return {
            ...result,
        };
    }

    const decoded = await decodeGatePacket(root, buffer, { bodyTransform, bodyType });
    decoded.input.format = format;
    return decoded;
}

function walkTypes(namespace, prefix, result) {
    if (!namespace || !namespace.nested) return;
    for (const [name, child] of Object.entries(namespace.nested)) {
        const fullName = prefix ? `${prefix}.${name}` : name;
        if (child && child.fields) result.push(fullName);
        walkTypes(child, fullName, result);
    }
}

async function listProtocolTypes() {
    await loadProto();
    const root = getRoot();
    return collectProtocolTypes(root);
}

module.exports = {
    decodeProtocolPacket,
    listProtocolTypes,
    RPC_TYPES,
    NOTIFY_TYPES,
};
