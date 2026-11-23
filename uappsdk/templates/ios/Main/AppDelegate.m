//
//  AppDelegate.m
//  Pandora
//
//  Created by Mac Pro_C on 12-12-26.
//  Copyright (c) 2012年 __MyCompanyName__. All rights reserved.
//

#import "AppDelegate.h"
#import "PDRCore.h"
#import "PDRCommonString.h"
#import "ViewController.h"
#import "PDRCoreApp.h"
#import "PDRCoreAppManager.h"
#import "PDRCoreWindowManager.h"
#import "PDRCoreAppWindow.h"
#import "PDRCoreAppFrame.h"
#import "H5WEEngineExport.h"   // H5WEWebEngine.allowsBackForwardNavigationGestures
#import <objc/runtime.h>       // class_copyMethodList（RTL_DUMP_SELECTORS）
#import <objc/message.h>       // objc_msgSend：调用未公开的 popGesture / isScreenEdgePanSkip


// =====================================================================================
// RTL 右缘返回（原生实现）
//
// 背景（已实测，细节见 ../README.md「右缘返回」一节）：
//   - DCloud 的侧滑返回是 H5CoreScreenEdgePan 自建手势，edges 在创建时锁死为 Left，
//     事后改 edges 只改属性、不改触摸区；把 pan 换成右缘识别器也拿不到事件 → 不能复用。
//   - 原生左缘手势也不能靠"定时 setEnabled:NO"关：PDRCore 切页时会重新启用，
//     所以改成拦截 UIView -addGestureRecognizer:，左缘识别器加入即被摘掉。
//
// 交互：
//   Began   → 判定能否返回：可见 frame ≥2、非 tab 根页、popGesture 不为 None/Skip、webview style 不为 none
//   Changed → 当前页 PDRCoreAppFrame.frame 跟手左移（下层页做 1/3 视差）
//   Ended   → 位移超 30% 或速度够快则滑出并 uni.navigateBack()，否则回弹
// =====================================================================================
// 功能总开关（可选配置，模板默认关）。启用方式二选一：
//   1) config/custom.yml 的 GCC_PREPROCESSOR_DEFINITIONS 追加 RTL_EDGE_BACK=1（推荐，
//      不动源码；该键会整体覆盖 base.yml 的同名值，custom.yml 注释里的示例已带上其现有宏）
//   2) 把下面的默认值直接改成 1
#ifndef RTL_EDGE_BACK
#define RTL_EDGE_BACK 0          // 0 = 关闭；1 = 启用右缘返回
#endif
#define RTL_EDGE_BACK_FOLLOW 1   // 1 = 跟手位移；0 = 只做阈值判定，不移动页面
#define RTL_DUMP_SELECTORS 0     // 1 = 启动时 dump PDRCore 相关类的方法名（SDK 升级排查用）

#if RTL_EDGE_BACK
@interface RTLBackController : NSObject <UIGestureRecognizerDelegate>
@property (nonatomic, weak) PDRCoreWindowManager *windowManager;
@property (nonatomic, strong) PDRCoreAppFrame *draggingFrame;
@property (nonatomic, assign) CGRect originalFrame;
@property (nonatomic, assign) CGFloat screenWidth;
@property (nonatomic, assign) BOOL canBack;
@property (nonatomic, assign) BOOL dragging;
@property (nonatomic, strong) UIView *dimView;
@property (nonatomic, strong) PDRCoreAppFrame *behindFrame;
@property (nonatomic, assign) CGRect behindOriginalFrame;
@property (nonatomic, strong) UIView *shadowView;
@property (nonatomic, strong) NSTimer *guardTimer;
@property (nonatomic, weak) PDRCoreAppFrame *configuredFrame;
@property (nonatomic, strong) UIScreenEdgePanGestureRecognizer *rightEdgeRecognizer;
@end

@implementation RTLBackController

- (PDRCoreWindowManager *)findWindowManagerIn:(UIView *)view {
    if (!view) return nil;
    if ([view isKindOfClass:[PDRCoreWindowManager class]]) return (PDRCoreWindowManager *)view;
    for (UIView *sub in view.subviews) {
        PDRCoreWindowManager *found = [self findWindowManagerIn:sub];
        if (found) return found;
    }
    return nil;
}

- (void)collectFrames:(UIView *)view into:(NSMutableArray *)list {
    if ([view isKindOfClass:[PDRCoreAppFrame class]]) [list addObject:view];
    for (UIView *sub in view.subviews) [self collectFrames:sub into:list];
}

- (PDRCoreAppWindow *)appWindow {
    // 注意：PDRCoreAppWindow 不一定是 wm 的直接子视图（实测中间还隔一层 contentView），
    // 所以必须递归找，不能只遍历直接子视图。
    NSMutableArray *stack = [NSMutableArray arrayWithObject:self.windowManager];
    PDRCoreAppWindow *found = nil;
    while (stack.count > 0) {
        UIView *v = [stack lastObject];
        [stack removeLastObject];
        if ([v isKindOfClass:[PDRCoreAppWindow class]]) found = (PDRCoreAppWindow *)v;
        [stack addObjectsFromArray:v.subviews];
    }
    return found;
}

// tab 页的 frame 挂在 DCTabManagerView 下（实测层级特征），这类页面没有"上一页"
- (BOOL)isTabFrame:(UIView *)frame {
    for (UIView *v = frame.superview; v; v = v.superview) {
        if ([NSStringFromClass([v class]) isEqualToString:@"DCTabManagerView"]) return YES;
    }
    return NO;
}

- (NSArray<PDRCoreAppFrame *> *)visibleFrames {
    PDRCoreAppWindow *appWindow = [self appWindow];
    if (!appWindow) return @[];
    NSMutableArray *all = [NSMutableArray array];
    [self collectFrames:appWindow into:all];
    NSMutableArray *visible = [NSMutableArray array];
    for (PDRCoreAppFrame *frame in all) {
        if (frame.hidden || frame.alpha < 0.01 || frame.window == nil) continue;
        [visible addObject:frame];
    }
    return visible;
}

// 原生判定：可见 frame 至少 2 个（当前页 + 下面那页）才算"可返回"，
// 并且当前页不能是 popGesture:none 的全屏页。
// ⚠️ 排除清单与 pages.json 里 popGesture:none / disableSwipeBack 的页面一一对应；
//    改 pages.json 后跑 `npm run check:ios` 校验（脚本会打印每个页面对应的关键字）。
// 页面能否被"滑退"的判定：尽量读参考实现自己用的值。
//
// 反汇编结论（lipo -thin + ar x + otool -rv）：
//   -[PDRCoreAppFrame isScreenEdgePanSkip] 只有三条指令：
//        return [self popGesture] == 3;      // 3 = PDRCoreAppPopGestureSkip
//   -[PDRCoreAppWindow(_ScreenEdge) isScreenEdgePanSkipAppframe:] 的最后一跳就是上面这个。
//   枚举：None=0 / Close=1 / Hide=2 / Skip=3 / AppBack=4。
//   → 也就是说 "popGesture: none" 并不走 isScreenEdgePanSkip，需另外读 popGesture 数值。
//
// 真机实测（2026-10）：
//   禁止滑动的全屏弹窗页 → popGesture=0(None)，普通二级页 → popGesture=1(Close)。
//   另：页面 href 恒为 .../www/__uniappview.html（uni-app 共用 HTML 外壳），
//   任何基于 href 的页面识别都不成立；页面 JS 里 plus.webview 的 style.popGesture 在真机取不到值。
- (NSInteger)framePopGesture:(PDRCoreAppFrame *)frame {
    SEL selector = NSSelectorFromString(@"popGesture");
    if (![frame respondsToSelector:selector]) return -1;
    return ((NSInteger (*)(id, SEL))objc_msgSend)(frame, selector);
}

- (BOOL)frameSkipsEdgePan:(PDRCoreAppFrame *)frame {
    SEL selector = NSSelectorFromString(@"isScreenEdgePanSkip");
    if (![frame respondsToSelector:selector]) return NO;
    return ((BOOL (*)(id, SEL))objc_msgSend)(frame, selector);
}

- (NSString *)edgeGateDescription:(PDRCoreAppFrame *)frame {
    if (!frame) return @"no-frame";
    return [NSString stringWithFormat:@"popGesture=%ld skip=%@",
            (long)[self framePopGesture:frame],
            [self frameSkipsEdgePan:frame] ? @"YES" : @"NO"];
}

- (BOOL)canGoBackWithFrames:(NSArray<PDRCoreAppFrame *> *)frames
                        top:(PDRCoreAppFrame **)outTop {
    PDRCoreAppFrame *top = frames.lastObject;
    if (outTop) *outTop = top;
    if (top == nil) return NO;
    if (frames.count < 2) return NO;                 // 下面没有页面，滑了也无处可退
    if ([self isTabFrame:top]) return NO;            // 等价于 DCTabManagerView.isScreenEdgePanSkip
    if ([self frameSkipsEdgePan:top]) return NO;     // Skip(3)
    if ([self framePopGesture:top] == 0) return NO;  // None(0)：pages.json 的 popGesture: none
    return YES;
}

- (BOOL)installForWindow:(UIWindow *)window {
    PDRCoreWindowManager *wm = [self findWindowManagerIn:window];
    if (!wm) return NO;
    self.windowManager = wm;

    // 关掉 DCloud 锁死在左缘的手势；同时把它的 delegate 换成自己，
    // 这样即使 PDRCore 在切页时重新 setEnable:YES，也会被 shouldBegin 永久拒绝（定时器只能补救，有窗口期）
    wm.edgeGestureRecognizer.delegate = self;
    if (wm.edgeGestureRecognizer.isEnabled) {
        [wm.edgeGestureRecognizer setEnabled:NO];
        NSLog(@"[RTL-BACK] builtin left edge disabled");
    }

#if RTL_DUMP_SELECTORS
    // 一次性探明"参考实现"把每页的 popGesture 存在哪：dump PDRCoreAppFrame / H5UniversalApp
    // 里与 pop/gesture/style 相关的方法名，便于以后直接调用同一个 getter
    {
        NSArray<NSString *> *classes = @[@"PDRCoreAppFrame", @"PDRCoreAppWindow", @"H5UniversalApp",
                                         @"PDRCoreAppInfo", @"PDRCoreWindowManager"];
        NSArray<NSString *> *keywords = @[@"pop", @"gesture", @"style", @"swipe", @"back"];
        for (NSString *name in classes) {
            Class cls = NSClassFromString(name);
            if (!cls) continue;
            unsigned int count = 0;
            Method *methods = class_copyMethodList(cls, &count);
            NSMutableArray *hits = [NSMutableArray array];
            for (unsigned int i = 0; i < count; i++) {
                NSString *sel = NSStringFromSelector(method_getName(methods[i]));
                for (NSString *kw in keywords) {
                    if ([sel.lowercaseString containsString:kw]) { [hits addObject:sel]; break; }
                }
            }
            free(methods);
            if (hits.count) {
                NSLog(@"[RTL-BACK] %@ relevant selectors: %@", name,
                      [[hits sortedArrayUsingSelector:@selector(compare:)] componentsJoinedByString:@", "]);
            }
        }
    }
#endif

    UIScreenEdgePanGestureRecognizer *pan =
        [[UIScreenEdgePanGestureRecognizer alloc] initWithTarget:self action:@selector(onEdgePan:)];
    pan.edges = UIRectEdgeRight;      // 必须在加入视图之前设置
    self.rightEdgeRecognizer = pan;
    pan.delegate = self;
    // 挂到 wm 的父视图（= 原 DCloud 左缘识别器所在层级）：比 window 更靠近触摸路径，
    // 不容易被 WKWebView 的滚动 pan 抢先取消
    UIView *host = wm.superview ?: window;
    [host addGestureRecognizer:pan];

    // PDRCore 的 pan 有 setEnable:，切页时可能把它自己重新启用 → 定期把左缘按回去
    __weak typeof(self) weakSelf = self;
    self.guardTimer = [NSTimer scheduledTimerWithTimeInterval:1.0
                                                      repeats:YES
                                                        block:^(NSTimer *timer) {
        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (!strongSelf) { [timer invalidate]; return; }
        // 顶层页面变化时，关掉 WKWebView 自带的滑动前进/后退手势
        PDRCoreAppFrame *top = [[strongSelf visibleFrames] lastObject];
        if (top && top.webEngine && top != strongSelf.configuredFrame) {
            top.webEngine.allowsBackForwardNavigationGestures = NO;
            strongSelf.configuredFrame = top;
            NSLog(@"[RTL-BACK] disabled webview back-forward gestures on frame=%p", (__bridge void *)top);
        }

        static NSInteger tick = 0;
        if (++tick % 4 == 0) {
            // 兜底：拦截器已覆盖"新加入"的左缘识别器，这里再收一遍"早就存在"的
            [strongSelf blockForeignEdgeRecognizersIn:strongSelf.windowManager.window];
        }

        UIGestureRecognizer *builtin = strongSelf.windowManager.edgeGestureRecognizer;
        if (builtin.delegate != strongSelf) {
            builtin.delegate = strongSelf;                 // PDRCore 改回了 delegate → 抢回来
            NSLog(@"[RTL-BACK] builtin delegate was reset -> reclaimed");
        }
        if (builtin.isEnabled) {
            [builtin setEnabled:NO];                       // 复活就再关掉
            NSLog(@"[RTL-BACK] builtin left edge was re-enabled by PDRCore -> disabled again");
        }
    }];

    NSLog(@"[RTL-BACK] installed: edges=Right follow=%d host=%@ hostGestures=%lu",
          RTL_EDGE_BACK_FOLLOW,
          NSStringFromClass([host class]),
          (unsigned long)host.gestureRecognizers.count);
    return YES;
}

// 同时准备"下层压暗 + 页面边缘投影"两件视觉元素，起手时调用一次
- (void)attachDimAndShadowToFrame:(PDRCoreAppFrame *)frame {
    [self removeDimAndShadow];
    UIView *container = frame.superview;
    if (!container) return;
    NSUInteger index = [container.subviews indexOfObject:frame];
    if (index == NSNotFound) index = container.subviews.count;

    // 压暗层：铺满容器，压在下层页面之上、当前页之下
    UIView *dim = [[UIView alloc] initWithFrame:container.bounds];
    dim.backgroundColor = [UIColor blackColor];
    dim.alpha = 0.0;
    dim.userInteractionEnabled = NO;
    [container insertSubview:dim atIndex:index];
    self.dimView = dim;

    // 边缘投影：与原生左滑同一张图（-[PDRCoreAppFrame showShadowView] 的实现）
    // 原实现是 frame = (-10, 0, 10, bounds.height) 贴在页面**左侧**，作为页面子视图；
    // RTL 下页面往左滑、右侧露出下层，所以镜像到右缘并水平翻转（暗端贴页面）。
    UIImage *shadowImage = [UIImage imageNamed:@"PandoraApi.bundle/left-shadow-img@2x.png"];
    UIView *shadow = nil;
    if (shadowImage) {
        UIImageView *imageView = [[UIImageView alloc] initWithImage:shadowImage];
        imageView.userInteractionEnabled = NO;
        imageView.transform = CGAffineTransformMakeScale(-1.0, 1.0);
        CGRect bounds = frame.bounds;
        imageView.bounds = CGRectMake(0.0, 0.0, 10.0, CGRectGetHeight(bounds));
        imageView.center = CGPointMake(CGRectGetWidth(bounds) + 5.0, CGRectGetMidY(bounds));
        frame.clipsToBounds = NO;          // 与原生一致：允许阴影画到页面边界之外
        [frame addSubview:imageView];       // 作为页面子视图 → 跟手位移自动生效
        shadow = imageView;
    } else {
        // 兜底：bundle 里没有这张图时退回同尺寸的渐变（10pt / 0.10，观感接近）
        UIView *fallback = [[UIView alloc] initWithFrame:CGRectMake(CGRectGetMaxX(frame.frame),
                                                                    CGRectGetMinY(frame.frame),
                                                                    10.0,
                                                                    CGRectGetHeight(frame.frame))];
        fallback.userInteractionEnabled = NO;
        CAGradientLayer *gradient = [CAGradientLayer layer];
        gradient.colors = @[(__bridge id)[UIColor colorWithWhite:0.0 alpha:0.10].CGColor,
                            (__bridge id)[UIColor colorWithWhite:0.0 alpha:0.0].CGColor];
        gradient.startPoint = CGPointMake(0.0, 0.5);
        gradient.endPoint = CGPointMake(1.0, 0.5);
        gradient.frame = fallback.bounds;
        [fallback.layer addSublayer:gradient];
        [container insertSubview:fallback atIndex:index + 1];
        shadow = fallback;
    }
    self.shadowView = shadow;
}

- (void)removeDimAndShadow {
    [self.dimView removeFromSuperview];
    self.dimView = nil;
    [self.shadowView removeFromSuperview];   // 阴影是页面子视图，移除即可
    self.shadowView = nil;
}


// 全树扫描：PDRCore 可能为每个页面各建一个左缘识别器，
// 只处理 wm.edgeGestureRecognizer 会漏（实测：快速左滑仍能关闭）
- (void)blockForeignEdgeRecognizersIn:(UIView *)view {
    if (!view) return;
    for (UIGestureRecognizer *gesture in view.gestureRecognizers) {
        if (gesture == self.rightEdgeRecognizer) continue;
        if (![gesture isKindOfClass:[UIScreenEdgePanGestureRecognizer class]]) continue;
        if (gesture.delegate != self) {
            NSString *previous = gesture.delegate ? NSStringFromClass([gesture.delegate class]) : @"nil";
            gesture.delegate = self;
            NSLog(@"[RTL-BACK] claimed edge recognizer %p on %@ edges=%@ delegateWas=%@",
                  (__bridge void *)gesture,
                  NSStringFromClass([view class]),
                  [self edgesText:((UIScreenEdgePanGestureRecognizer *)gesture).edges],
                  previous);
        }
    }
    for (UIView *sub in view.subviews) {
        [self blockForeignEdgeRecognizersIn:sub];
    }
}

- (NSString *)edgesText:(UIRectEdge)edges {
    NSMutableArray *parts = [NSMutableArray array];
    if (edges & UIRectEdgeTop) [parts addObject:@"Top"];
    if (edges & UIRectEdgeLeft) [parts addObject:@"Left"];
    if (edges & UIRectEdgeBottom) [parts addObject:@"Bottom"];
    if (edges & UIRectEdgeRight) [parts addObject:@"Right"];
    return parts.count ? [parts componentsJoinedByString:@"|"] : @"None";
}

- (void)onEdgePan:(UIScreenEdgePanGestureRecognizer *)gesture {
    UIView *host = self.windowManager;
    CGPoint t = [gesture translationInView:host];
    CGFloat width = gesture.view.bounds.size.width;

    switch (gesture.state) {
        case UIGestureRecognizerStateBegan: {
            self.dragging = NO;
            NSArray<PDRCoreAppFrame *> *frames = [self visibleFrames];
            PDRCoreAppFrame *topFrame = nil;
            self.canBack = [self canGoBackWithFrames:frames top:&topFrame];
            self.draggingFrame = topFrame;
            NSLog(@"[RTL-BACK] began frames=%lu canBack=%@ %@ builtin=%@@%p webviewGestures=%lu",
                  (unsigned long)frames.count,
                  self.canBack ? @"YES" : @"NO",
                  [self edgeGateDescription:topFrame],
                  self.windowManager.edgeGestureRecognizer.isEnabled ? @"enabled" : @"disabled",
                  (__bridge void *)self.windowManager.edgeGestureRecognizer,
                  (unsigned long)topFrame.webEngine.allowsBackForwardNavigationGestures);
            if (!self.canBack) return;
            self.originalFrame = self.draggingFrame.frame;
            self.screenWidth = width;
            [self attachDimAndShadowToFrame:self.draggingFrame];

            // 下层页做视差：先挪到 +w/3（被当前页完全遮住，不可见），随后随进度回到 0
            self.behindFrame = (frames.count >= 2) ? frames[frames.count - 2] : nil;
            if (self.behindFrame) {
                self.behindOriginalFrame = self.behindFrame.frame;
                CGRect behind = self.behindOriginalFrame;
                behind.origin.x = self.behindOriginalFrame.origin.x + width / 3.0;
                self.behindFrame.frame = behind;
            }
            self.dragging = YES;
            break;
        }
        case UIGestureRecognizerStateChanged: {
            if (!self.dragging) return;
            CGFloat dx = MIN(0.0, MAX(-self.screenWidth, t.x));
#if RTL_EDGE_BACK_FOLLOW
            CGRect f = self.originalFrame;
            f.origin.x = self.originalFrame.origin.x + dx;
            self.draggingFrame.frame = f;
            CGFloat progress = MIN(1.0, fabs(dx) / MAX(1.0, self.screenWidth));
            self.dimView.alpha = 0.35 * (1.0 - 0.6 * progress);
            if (self.behindFrame) {
                CGRect behind = self.behindOriginalFrame;
                behind.origin.x = self.behindOriginalFrame.origin.x
                                  + (1.0 - progress) * (self.screenWidth / 3.0);
                self.behindFrame.frame = behind;
            }
#endif
            break;
        }
        case UIGestureRecognizerStateEnded:
        case UIGestureRecognizerStateCancelled: {
            if (!self.dragging) return;
            self.dragging = NO;
            CGFloat dx = MIN(0.0, MAX(-self.screenWidth, t.x));
            CGPoint v = [gesture velocityInView:host];
            BOOL commit = (fabs(dx) > self.screenWidth * 0.3) || (v.x < -300.0);
            NSLog(@"[RTL-BACK] end dx=%.1f vx=%.1f commit=%@", dx, v.x, commit ? @"YES" : @"NO");
            [self finishWithCommit:commit];
            break;
        }
        default:
            break;
    }
}

- (void)finishWithCommit:(BOOL)commit {
    PDRCoreAppFrame *frame = self.draggingFrame;
    CGRect original = self.originalFrame;
    CGFloat screenWidth = self.screenWidth;
    UIView *dim = self.dimView;
    UIView *shadow = self.shadowView;
    PDRCoreAppFrame *behind = self.behindFrame;
    CGRect behindOriginal = self.behindOriginalFrame;

    self.draggingFrame = nil;
    self.dimView = nil;
    self.shadowView = nil;
    self.behindFrame = nil;
    if (!frame) return;

    if (!commit) {
        // 回弹：当前页往右盖回来，下层页也往右退回去（RTL 镜像方向），再瞬移归位
        CGRect behindHidden = behindOriginal;
        behindHidden.origin.x = behindOriginal.origin.x + screenWidth / 3.0;
        [UIView animateWithDuration:0.2
                         animations:^{
            frame.frame = original;
            if (behind) behind.frame = behindHidden;
            dim.alpha = 0.0;
            shadow.alpha = 0.0;
        }
                         completion:^(BOOL finished) {
            // 此刻下层页已被当前页完全遮住，瞬移回原位不会有任何视觉变化
            if (behind) behind.frame = behindOriginal;
            [dim removeFromSuperview];
            [shadow removeFromSuperview];
        }];
        return;
    }

    // 滑出后先把页面藏起来，再让 PDRCore 播它自己的 pop 动画（看不见 → 不会出现第二次退出动画）
    [UIView animateWithDuration:0.2
                     animations:^{
        CGRect f = original;
        f.origin.x = original.origin.x - screenWidth;
        frame.frame = f;
        if (behind) behind.frame = behindOriginal;
        // 压暗与投影跟页面一起淡出（用户要求：和页面同时消失，不要拖到动画结束才抹掉）
        dim.alpha = 0.0;
        shadow.alpha = 0.0;
    }
                     completion:^(BOOL finished) {
        frame.hidden = YES;
        [dim removeFromSuperview];
        [shadow removeFromSuperview];
        if (behind) behind.frame = behindOriginal;
        NSString *result = [frame stringByEvaluatingJavaScriptFromString:@"uni.navigateBack()"];
        NSLog(@"[RTL-BACK] navigateBack -> %@", result);
        // 页面被真正关闭后这些都是无害的；若 navigateBack 没生效，保证不留下隐藏的空页
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.6 * NSEC_PER_SEC)),
                       dispatch_get_main_queue(), ^{
            frame.hidden = NO;
            frame.frame = original;
        });
    }];
}

- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gestureRecognizer
shouldRecognizeSimultaneouslyWithGestureRecognizer:(UIGestureRecognizer *)otherGestureRecognizer {
    // 我方右缘手势允许与页面滚动/横滑共存：
    // 返回 NO 时，只要 webview 的 pan 先识别，我们的手势就被取消 —— 实测表现为"只有约 1/3 概率能触发"
    if (gestureRecognizer == self.rightEdgeRecognizer || otherGestureRecognizer == self.rightEdgeRecognizer) {
        return YES;
    }
    return NO;
}

- (BOOL)gestureRecognizerShouldBegin:(UIGestureRecognizer *)gestureRecognizer {
    if (gestureRecognizer == self.rightEdgeRecognizer) return YES;
    // 除我方右缘手势外，任何屏幕边缘手势一律拒绝（原生左缘 + 各页面自建的那些）
    if ([gestureRecognizer isKindOfClass:[UIScreenEdgePanGestureRecognizer class]]) {
        NSLog(@"[RTL-BACK] blocked edge gesture %p on %@ edges=%@",
              (__bridge void *)gestureRecognizer,
              gestureRecognizer.view ? NSStringFromClass([gestureRecognizer.view class]) : @"nil",
              [self edgesText:((UIScreenEdgePanGestureRecognizer *)gestureRecognizer).edges]);
        return NO;
    }
    return YES;
}

@end

static RTLBackController *gRTLBackController = nil;

// ---------------------------------------------------------------------------------
// 左缘识别器"出生即拦截"
//
// 为什么不用定时扫描：PDRCore 在切页时会把它自己的 H5CoreScreenEdgePan 重新启用
// （setEnable: 可能连带把 delegate 改回自己），扫描总有窗口期 —— 实测表现为
// "不用很快，只要在某个范围内滑动就能触发返回"。
//
// 这里直接换掉 UIView 的 addGestureRecognizer:：任何时刻被添加的左缘识别器
// 在添加完成的同一 runloop 内就被摘掉，不存在窗口期。
// 我方右缘识别器 edges 只有 Right，不受影响。
// ---------------------------------------------------------------------------------
static IMP gRTLEdgeOriginalAddGesture = NULL;

static void RTLEdgeAddGestureRecognizer(id view, SEL _cmd, UIGestureRecognizer *gesture) {
    ((void (*)(id, SEL, UIGestureRecognizer *))gRTLEdgeOriginalAddGesture)(view, _cmd, gesture);

    if (![gesture isKindOfClass:[UIScreenEdgePanGestureRecognizer class]]) return;
    UIRectEdge edges = ((UIScreenEdgePanGestureRecognizer *)gesture).edges;
    if ((edges & UIRectEdgeLeft) == 0) return;   // 只处理左缘；我方右缘不受影响

    [(UIView *)view removeGestureRecognizer:gesture];
    NSLog(@"[RTL-BACK] removed left-edge recognizer %p from %@ (edges=Left)",
          (__bridge void *)gesture, NSStringFromClass([(UIView *)view class]));
}

static void RTLInstallEdgeGestureInterceptor(void) {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        SEL selector = NSSelectorFromString(@"addGestureRecognizer:");
        Method method = class_getInstanceMethod([UIView class], selector);
        if (!method) {
            NSLog(@"[RTL-BACK] interceptor NOT installed (method not found)");
            return;
        }
        gRTLEdgeOriginalAddGesture = method_getImplementation(method);
        method_setImplementation(method, (IMP)RTLEdgeAddGestureRecognizer);
        NSLog(@"[RTL-BACK] addGestureRecognizer: interceptor installed");
    });
}
#endif


@interface AppDelegate()<PDRCoreDelegate>
@property (strong, nonatomic) ViewController *h5ViewContoller;
#if RTL_EDGE_BACK
- (void)rtlInstallEdgeBack;
- (void)rtlInstallEdgeBackAttempt:(NSInteger)attempt;
#endif
@end

@implementation AppDelegate

@synthesize window = _window;
@synthesize rootViewController;
#pragma mark -
#pragma mark app lifecycle
/*
 * @Summary:程序启动时收到push消息
 */
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
#if RTL_EDGE_BACK
    // 必须在 PDRCore 初始化之前装：这样连它"出生"时创建的那一个左缘识别器也会被立刻摘掉
    RTLInstallEdgeGestureInterceptor();
#endif
    return [PDRCore initEngineWihtOptions:launchOptions
                              withRunMode:PDRCoreRunModeNormal withDelegate:self];
}

- (void)configureWindow:(UIWindow *)window
{
    self.window = window;
    
    ViewController *viewController = [[ViewController alloc] init];
    self.h5ViewContoller = viewController;
    
    UINavigationController *navigationController = [[UINavigationController alloc] initWithRootViewController:viewController];
    self.rootViewController = navigationController;
    navigationController.navigationBarHidden = YES;
    {
        [self startMainApp];
        self.h5ViewContoller.showLoadingView = YES;
    }
    self.window.rootViewController = navigationController;
    [self.window makeKeyAndVisible];
}

-(BOOL)getStatusBarHidden {
    return [self.h5ViewContoller getStatusBarHidden];
}

-(UIStatusBarStyle)getStatusBarStyle {
    return [self.h5ViewContoller getStatusBarStyle];
}
-(void)setStatusBarStyle:(UIStatusBarStyle)statusBarStyle {
    [self.h5ViewContoller setStatusBarStyle:statusBarStyle];
}

-(void)wantsFullScreen:(BOOL)fullScreen
{
    [self.h5ViewContoller wantsFullScreen:fullScreen];
}

#if RTL_EDGE_BACK
#pragma mark - RTL 右缘返回

- (void)rtlInstallEdgeBack {
    [self rtlInstallEdgeBackAttempt:1];
}

- (void)rtlInstallEdgeBackAttempt:(NSInteger)attempt {
    if (gRTLBackController) return;                 // 已装好
    RTLInstallEdgeGestureInterceptor();              // 先装拦截器，再挂我方手势

    UIWindow *keyWindow = self.window;
    if (!keyWindow) {
        NSLog(@"[RTL-BACK] window nil at attempt %ld", (long)attempt);
    } else {
        RTLBackController *controller = [[RTLBackController alloc] init];
        if ([controller installForWindow:keyWindow]) {
            gRTLBackController = controller;
            NSLog(@"[RTL-BACK] ready at attempt %ld", (long)attempt);
            return;
        }
    }

    if (attempt >= 20) {                            // 0.5s × 20 ≈ 10s 后放弃
        NSLog(@"[RTL-BACK] gave up after %ld attempts", (long)attempt);
        return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
        [self rtlInstallEdgeBackAttempt:attempt + 1];
    });
}
#endif

#pragma mark -
- (void)startMainApp {
    dispatch_async(dispatch_get_main_queue(), ^(void) {
        [[PDRCore Instance] start];
#if RTL_EDGE_BACK
        // 等 PDRCore 把 windowManager / 页面 frame 挂好
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.5 * NSEC_PER_SEC)),
                       dispatch_get_main_queue(), ^{
            [self rtlInstallEdgeBack];
        });
#endif
    });
}

- (void)application:(UIApplication *)application performActionForShortcutItem:(UIApplicationShortcutItem *)shortcutItem
  completionHandler:(void(^)(BOOL succeeded))completionHandler{
    [PDRCore handleSysEvent:PDRCoreSysEventPeekQuickAction withObject:shortcutItem];
    completionHandler(true);
}

- (void)applicationWillTerminate:(UIApplication *)application
{
    // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    [PDRCore destoryEngine];
}

#pragma mark -
#pragma mark URL

- (BOOL)application:(UIApplication *)application
            openURL:(NSURL *)url
  sourceApplication:(NSString *)sourceApplication
         annotation:(id)annotation {
    [self application:application handleOpenURL:url];
    return YES;
}

/*
 * @Summary:程序被第三方调用，传入参数启动
 *
 */
- (BOOL)application:(UIApplication *)application handleOpenURL:(NSURL *)url
{
    [PDRCore handleSysEvent:PDRCoreSysEventOpenURL withObject:url];
    return YES;
}
- (BOOL)application:(UIApplication *)application openURL:(nonnull NSURL *)url options:(nonnull NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options {
    [PDRCore handleSysEvent:PDRCoreSysEventOpenURLWithOptions withObject:@[url,options]];
    return YES;
}

/*
 * @Summary:通用链接
 */
- (BOOL)application:(UIApplication *)application continueUserActivity:(NSUserActivity *)userActivity restorationHandler:(void(^)(NSArray<id<UIUserActivityRestoring>> * __nullable restorableObjects))restorationHandler {
    [PDRCore handleSysEvent:PDRCoreSysEventContinueUserActivity withObject:userActivity];
    restorationHandler(nil);
    return YES;
}
@end

@implementation UINavigationController(Orient)

-(BOOL)shouldAutorotate{
    return ![PDRCore Instance].lockScreen;
    return YES;
}

- (UIInterfaceOrientationMask)supportedInterfaceOrientations{
    if([self.topViewController isKindOfClass:[ViewController class]])
        return [self.topViewController supportedInterfaceOrientations];
    return UIInterfaceOrientationMaskPortrait;
}
@end
