using Bunit;
using Microsoft.Extensions.DependencyInjection;
using Radzen.Blazor.Rendering;
using Xunit;

namespace Radzen.Blazor.Tests
{
    public class DialogContainerTests
    {
        private static TestContext CreateContext()
        {
            var ctx = new TestContext();
            // DialogContainer calls Radzen.openDialog once rendered.
            ctx.JSInterop.Mode = JSRuntimeMode.Loose;
            ctx.Services.AddScoped(_ => new DialogService(null, null));
            return ctx;
        }

        private static IRenderedComponent<DialogContainer> RenderDialog(TestContext ctx, DialogOptions options)
        {
            var dialog = new Dialog { Title = "Test", Options = options };

            return ctx.RenderComponent<DialogContainer>(parameters => parameters.Add(p => p.Dialog, dialog));
        }

        [Fact(DisplayName = "OnResize applies the reported size to the dialog")]
        public void OnResize_Applies_ReportedSize()
        {
            using var ctx = CreateContext();
            var component = RenderDialog(ctx, new DialogOptions { Width = "600px", Resizable = true });

            component.Instance.OnResize(500, 400);
            component.Render();

            var style = component.Find(".rz-dialog").GetAttribute("style");

            Assert.Contains("width: 500px", style);
            Assert.Contains("height: 400px", style);
        }

        [Fact(DisplayName = "OnResize ignores a zero measurement")]
        public void OnResize_Ignores_ZeroMeasurement()
        {
            using var ctx = CreateContext();
            var component = RenderDialog(ctx, new DialogOptions { Width = "600px", Resizable = true });

            // A hidden or not yet laid out dialog measures 0x0. Applying that would collapse
            // the dialog for good, since the applied size wins over Width and over CSS.
            component.Instance.OnResize(0, 0);
            component.Render();

            var style = component.Find(".rz-dialog").GetAttribute("style");

            Assert.Contains("width: 600px", style);
            Assert.DoesNotContain("width: 0px", style);
            Assert.DoesNotContain("height: 0px", style);
        }

        [Fact(DisplayName = "OnResize invokes the Resize callback")]
        public void OnResize_Invokes_ResizeCallback()
        {
            using var ctx = CreateContext();
            System.Drawing.Size? reported = null;
            var component = RenderDialog(ctx, new DialogOptions
            {
                Width = "600px",
                Resizable = true,
                Resize = size => reported = size
            });

            component.Instance.OnResize(500, 400);

            Assert.Equal(new System.Drawing.Size(500, 400), reported);
        }
    }
}
