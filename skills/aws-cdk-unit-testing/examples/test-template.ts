/**
 * AWS CDK 単体テスト 雛形
 *
 * 3 種類のテスト (スナップショット / Fine-grained / バリデーション) を
 * 1 ファイルに収めたサンプル。実プロジェクトでは Stack や責務ごとに
 * test/*.test.ts を分割するのが一般的。
 *
 * 使い方:
 *   1. このファイルを test/my-stack.test.ts にコピー
 *   2. import パスを調整 (../lib/my-stack 等)
 *   3. 不要なセクションは削除
 */

import { App, assertions } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { MyStack } from '../lib/my-stack';

// ----------------------------------------------------------------------------
// Helper: 各テストで Stack/Template を作り直すための共通ヘルパー
// ----------------------------------------------------------------------------
const getTemplate = (
  props?: ConstructorParameters<typeof MyStack>[2],
): assertions.Template => {
  const app = new App();
  const stack = new MyStack(app, 'MyStack', props);
  return Template.fromStack(stack);
};

// ============================================================================
// 1. スナップショットテスト (原則必須)
// ============================================================================
describe('Snapshot Tests', () => {
  test('matches snapshot', () => {
    const template = getTemplate();
    expect(template.toJSON()).toMatchSnapshot();
  });
});

// ============================================================================
// 2. Fine-grained assertions テスト (使い所を選んで書く)
// ============================================================================
describe('Fine-grained assertions tests', () => {
  // --- (a) ループ処理: 生成個数の確認 ---
  test('SNS Topics are created from appNames (deduped)', () => {
    const template = getTemplate({
      appNames: ['App1', 'App1', 'App2'],
    });

    template.resourcePropertiesCountIs(
      'AWS::SNS::Topic',
      { DisplayName: Match.stringLikeRegexp('Topic') },
      2, // 重複排除されるので 2
    );
  });

  // --- (b) 条件分岐: リソース生成有無 ---
  test('Web ACL is created in prod', () => {
    const template = getTemplate({ isProd: true });
    template.resourceCountIs('AWS::WAFv2::WebACL', 1);
  });

  // --- (b') 条件分岐: プロパティ指定有無 (Match.absent) ---
  test('Web ACL is NOT associated in dev', () => {
    const template = getTemplate({ isProd: false });

    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        WebACLId: Match.absent(),
      },
    });
  });

  // --- (c) プロパティ override の確認 ---
  test('EventBridge notification is enabled via override', () => {
    const template = getTemplate();

    template.hasResourceProperties('AWS::S3::Bucket', {
      NotificationConfiguration: {
        EventBridgeConfiguration: { EventBridgeEnabled: true },
      },
    });
  });

  // --- (d) 特に保証したい定義: 「意思表示」テスト ---
  // 値が変動しても良ければ Match.anyValue() でメンテコストを下げる
  test('LifecycleConfiguration.Expiration must be specified', () => {
    const template = getTemplate();

    template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: [
          {
            ExpirationInDays: Match.anyValue(),
            Status: 'Enabled',
          },
        ],
      },
    });
  });

  // --- (d') addDependency による依存関係の確認 ---
  test('HostedZone depends on QueryLogResourcePolicy', () => {
    const template = getTemplate({ domainName: 'example.com' });

    template.hasResource('AWS::Route53::HostedZone', {
      DependsOn: [Match.stringLikeRegexp('QueryLogResourcePolicy')],
    });
  });

  // --- (e) props 経由の値の流入確認 ---
  test('messageRetentionPeriod is passed through from props', () => {
    const template = getTemplate({ messageRetentionPeriodInDays: 10 });

    template.hasResourceProperties('AWS::SNS::Topic', {
      ArchivePolicy: { MessageRetentionPeriod: 10 },
    });
  });
});

// ============================================================================
// 3. バリデーションテスト (バリデーション実装時のみ)
// ============================================================================
describe('Validation tests', () => {
  test('lifecycleDays must be <= 400', () => {
    const app = new App();

    expect(() => {
      new MyStack(app, 'MyStack', { lifecycleDays: 500 });
    }).toThrowError('ライフサイクル日数は400日以下にしてください');
  });
});
